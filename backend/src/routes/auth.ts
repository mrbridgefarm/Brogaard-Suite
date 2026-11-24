import { Router, type Request, type Response } from 'express';
import { fetchMailFolders } from '../services/mailClient.js';
import { fetchCalendars, normalizeMailcowUrl, type CalendarInfoDTO } from '../services/davClient.js';
import { getAliasesForUser } from '../services/aliasStore.js';
import { resolveAliasesWithMailcow } from '../services/mailcowAliases.js';
import { refreshPublicShareOwnerPassword } from '../services/shareStore.js';
import {
  refreshUserShareOwnerPassword,
  resolveIncomingSharesForRecipient
} from '../services/userShareStore.js';
import {
  getCalendarNameOverrides,
  resolveCalendarNameOverride,
  isSharedCalendarDismissed
} from '../services/calendarPrefsStore.js';
import {
  createRateLimiter,
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
        password: session.password
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
      password
    };

    // Primær autentificering mod IMAP
    const folders = await fetchMailFolders(mailCreds);

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
      password
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
    try {
      const incoming = resolveIncomingSharesForRecipient([
        username,
        ...aliases.map((a) => a.email)
      ]);
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

    try {
      calendars = calendars.filter(
        (c) =>
          !c.isShared ||
          activeIncomingNorms.has(decodeURIComponent(c.url || '').toLowerCase().replace(/\/+$/, '')) ||
          !isSharedCalendarDismissed(username, c.id, c.url)
      );
    } catch {
      // Ignorér filtreringsfejl
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
      caldavReady
    });
  } catch (err: any) {
    console.error('Suite login fejl:', err?.message || err);
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
