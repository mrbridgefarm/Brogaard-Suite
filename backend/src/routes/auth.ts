import { Router, type Request, type Response } from 'express';
import { fetchMailFolders } from '../services/mailClient.js';
import {
  fetchCalendars,
  verifyAndFetchSharedCalendar,
  canonicalSogoCalendarSignature,
  normalizeMailcowUrl,
  type CalendarInfoDTO
} from '../services/davClient.js';
import { getAliasesForUser } from '../services/aliasStore.js';
import { resolveAliasesWithMailcow } from '../services/mailcowAliases.js';
import { refreshPublicShareOwnerPassword } from '../services/shareStore.js';
import {
  refreshUserShareOwnerPassword,
  resolveIncomingSharesForRecipient,
  resolveIncomingSogoHintsForRecipient,
  removeUserCalendarShareByTarget
} from '../services/userShareStore.js';
import {
  getCalendarNameOverrides,
  resolveCalendarNameOverride,
  isSharedCalendarDismissed
} from '../services/calendarPrefsStore.js';
import {
  createRateLimiter,
  extractClientIp,
  getSessionFromCookie,
  setSessionCookie,
  clearSessionCookie,
  hasDefaultServerConfigured,
  getEnabledModules,
  getConfiguredSogoUrl,
  resolveSuiteServerConfig
} from '../services/sessionAuth.js';

export const authRouter = Router();

const loginLimiter = createRateLimiter(
  15,
  15 * 60 * 1000,
  'For mange loginforsøg. Vent venligst et par minutter og prøv igen.'
);

/**
 * GET /api/auth/config
 * Returnerer ikke-følsom konfiguration (afslører ALDRIG DEFAULT_MAIL_HOST / serveradresser).
 */
authRouter.get('/config', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    hasDefaultServer: hasDefaultServerConfigured(),
    enabledModules: getEnabledModules(),
    sogoUrl: getConfiguredSogoUrl()
  });
});

/**
 * GET /api/auth/session
 * Tjekker den krypterede HttpOnly SSO session-cookie.
 */
authRouter.get('/session', async (req: Request, res: Response) => {
  const session = getSessionFromCookie(req);
  if (!session) {
    res.json({ ok: true, authenticated: false });
    return;
  }

  let aliases = getAliasesForUser(session.username);
  try {
    const davUrl =
      session.caldavUrl ||
      normalizeMailcowUrl(process.env.DEFAULT_CALDAV_URL || `https://${session.imapHost}/SOGo/dav/`);
    const resolved = await resolveAliasesWithMailcow(
      {
        serverUrl: davUrl,
        username: session.username,
        password: session.password,
        clientIp: extractClientIp(req)
      },
      false
    );
    aliases = resolved.aliases;
  } catch (aliasErr: any) {
    console.warn('Alias-tjek ved session fejlede:', aliasErr?.message || aliasErr);
  }

  res.json({
    ok: true,
    authenticated: true,
    username: session.username,
    aliases
  });
});

/**
 * POST /api/auth/login
 * Validerer brugerens login mod Mailcow (IMAP + ikke-blokerende CalDAV & alias-opdagelse)
 * og sætter én samlet AES-256-GCM HttpOnly SSO-cookie på /api.
 */
authRouter.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const clientIp = extractClientIp(req);
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!username || !password) {
      res.status(400).json({ ok: false, error: 'Manglende e-mail eller adgangskode.' });
      return;
    }

    const serverCfg = resolveSuiteServerConfig({
      serverHost: req.body?.serverHost,
      imapHost: req.body?.imapHost,
      imapPort: req.body?.imapPort,
      imapSecure: req.body?.imapSecure,
      smtpHost: req.body?.smtpHost,
      smtpPort: req.body?.smtpPort,
      smtpSecure: req.body?.smtpSecure,
      caldavUrl: req.body?.caldavUrl
    });

    const mailCreds = {
      imapHost: serverCfg.imapHost,
      imapPort: serverCfg.imapPort,
      imapSecure: serverCfg.imapSecure,
      smtpHost: serverCfg.smtpHost,
      smtpPort: serverCfg.smtpPort,
      smtpSecure: serverCfg.smtpSecure,
      username,
      password,
      clientIp
    };

    // Primær autentificering mod IMAP
    const folders = await fetchMailFolders(mailCreds);

    const rawXff = req.headers['x-forwarded-for'];
    console.log(
      `[Auth] Suite login OK for ${username} – klient-IP: ${clientIp || 'ukendt'} ` +
        `(socket: ${req.socket?.remoteAddress || '?'}, x-forwarded-for: ${
          (Array.isArray(rawXff) ? rawXff.join(',') : rawXff) || '-'
        })`
    );

    // Sæt den fælles krypterede SSO-cookie
    setSessionCookie(req, res, {
      ...mailCreds,
      caldavUrl: serverCfg.caldavUrl
    });

    // Opdatér evt. krypterede kodeord på ejerens aktive delingslinks / bruger-delinger
    try {
      refreshPublicShareOwnerPassword(username, password);
      refreshUserShareOwnerPassword(username, password);
    } catch {
      // Ignorér ved skrivebeskyttet data-dir
    }

    const davCreds = {
      serverUrl: serverCfg.caldavUrl,
      username,
      password,
      clientIp
    };

    let aliases = getAliasesForUser(username);
    let calendars: CalendarInfoDTO[] = [];
    let caldavReady = false;

    await Promise.all([
      resolveAliasesWithMailcow(davCreds, true)
        .then((resAliases) => {
          aliases = resAliases.aliases;
        })
        .catch((aliasErr: any) => {
          console.warn('Mailcow alias-opdagelse ved login fejlede:', aliasErr?.message || aliasErr);
        }),
      fetchCalendars(davCreds)
        .then((fetched) => {
          calendars = fetched;
          caldavReady = true;
        })
        .catch((davErr: any) => {
          console.warn('CalDAV forhåndstjek ved login fejlede:', davErr?.message || davErr);
        })
    ]);

    const activeIncomingNorms = new Set<string>();
    const identityEmails = Array.from(
      new Set([username, ...aliases.map((a) => a.email)].map((e) => e.toLowerCase().trim()).filter(Boolean))
    );

    try {
      const incoming = resolveIncomingSharesForRecipient(identityEmails);
      const existingNorms = new Set(
        calendars.map((c) => decodeURIComponent(c.url || '').toLowerCase().replace(/\/+$/, ''))
      );
      for (const { share } of incoming) {
        const norm = decodeURIComponent(share.calendarUrl).toLowerCase().replace(/\/+$/, '');
        activeIncomingNorms.add(norm);
        if (existingNorms.has(norm)) {
          const match = calendars.find(
            (c) => decodeURIComponent(c.url || '').toLowerCase().replace(/\/+$/, '') === norm
          );
          if (match) {
            match.userShareId = share.id;
            if (share.permission === 'write') {
              match.readOnly = false;
              match.isShared = true;
              match.owner = share.ownerUsername;
              match.sharePermission = 'write';
            }
          }
        } else {
          calendars.push({
            id: share.calendarUrl,
            url: share.calendarUrl,
            name: share.calendarName,
            color: share.calendarColor,
            serverColor: share.calendarColor,
            readOnly: share.permission !== 'write',
            isShared: true,
            sharePermission: share.permission,
            userShareId: share.id,
            owner: share.ownerUsername
          });
        }
      }
    } catch {
      // Ignorér hvis incoming share opslag fejler ved login
    }

    let dismissedSharedCount = 0;
    try {
      calendars = calendars.filter((c) => {
        if (!c.isShared) return true;
        const normUrl = decodeURIComponent(c.url || '').toLowerCase().replace(/\/+$/, '');
        if (activeIncomingNorms.has(normUrl)) return true;
        if (isSharedCalendarDismissed(username, c.id, c.url)) {
          dismissedSharedCount += 1;
          return false;
        }
        return true;
      });
    } catch {
      // Ignorér filtreringsfejl
    }

    try {
      const sogoHints = resolveIncomingSogoHintsForRecipient(identityEmails);
      if (sogoHints.length > 0) {
        const presentNorms = new Set(
          calendars.map((c) => decodeURIComponent(c.url || '').toLowerCase().replace(/\/+$/, ''))
        );
        const presentSigs = new Set(
          calendars
            .map((c) => canonicalSogoCalendarSignature(c.url, c.owner))
            .filter((s): s is string => Boolean(s))
        );
        const hintsToVerify = sogoHints.filter((hint) => {
          const normHint = decodeURIComponent(hint.calendarUrl).toLowerCase().replace(/\/+$/, '');
          const sigHint = canonicalSogoCalendarSignature(hint.calendarUrl, hint.ownerUsername);
          if (presentNorms.has(normHint) || (sigHint && presentSigs.has(sigHint))) {
            return false;
          }
          if (isSharedCalendarDismissed(username, hint.calendarUrl, hint.calendarUrl)) {
            dismissedSharedCount += 1;
            return false;
          }
          return true;
        });

        if (hintsToVerify.length > 0) {
          const verified = await Promise.allSettled(
            hintsToVerify.map(async (hint) => {
              try {
                return await verifyAndFetchSharedCalendar(
                  davCreds,
                  hint.calendarUrl,
                  hint.calendarName,
                  hint.calendarColor
                );
              } catch (err: any) {
                if (/HTTP (?:401|403|404)\b/.test(String(err?.message || err))) {
                  removeUserCalendarShareByTarget(
                    hint.ownerUsername,
                    hint.calendarUrl,
                    hint.recipientEmail
                  );
                }
                return null;
              }
            })
          );
          for (const vr of verified) {
            if (vr.status === 'fulfilled' && vr.value) {
              calendars.push(vr.value);
            }
          }
        }
      }
    } catch {
      // Ignorér hvis SOGo-hint opslag fejler ved login
    }

    let nameOverrides: Record<string, string> = {};
    try {
      const savedNameOverrides = getCalendarNameOverrides(username);
      nameOverrides = { ...savedNameOverrides };
      for (const cal of calendars) {
        const origName = cal.serverName || cal.name;
        cal.serverName = origName;
        const alias = resolveCalendarNameOverride(savedNameOverrides, cal.id, cal.url);
        if (alias) {
          cal.name = alias;
          cal.localNameOverride = alias;
          nameOverrides[cal.id] = alias;
        } else {
          cal.localNameOverride = null;
        }
      }
    } catch {
      // Ignorér hvis kalender-præferencer fejler ved login
    }

    res.json({
      ok: true,
      username,
      folders,
      aliases,
      calendars,
      nameOverrides,
      dismissedSharedCount,
      caldavReady
    });
  } catch (err: any) {
    console.warn(
      `[Auth] Suite login fejl for ${String(req.body?.username || '').trim() || 'ukendt'} fra IP ${clientIp || 'ukendt'}:`,
      err?.message || err
    );
    res.status(401).json({
      ok: false,
      error: err?.message || 'Kunne ikke logge ind på Mailcow. Kontrollér e-mail og adgangskode.'
    });
  }
});

/**
 * POST /api/auth/logout
 * Sletter den fælles krypterede HttpOnly session-cookie.
 */
authRouter.post('/logout', (req: Request, res: Response) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});
