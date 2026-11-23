import { Router, type Request, type Response } from 'express';
import { fetchMailFolders } from '../services/mailClient.js';
import { fetchCalendars, type CalendarInfoDTO } from '../services/davClient.js';
import { getAliasesForUser } from '../services/aliasStore.js';
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
authRouter.get('/session', (req: Request, res: Response) => {
  const session = getSessionFromCookie(req);
  if (!session) {
    res.json({ ok: true, authenticated: false });
    return;
  }
  const aliases = getAliasesForUser(session.username);
  res.json({
    ok: true,
    authenticated: true,
    username: session.username,
    aliases
  });
});

/**
 * POST /api/auth/login
 * Validerer brugerens login mod Mailcow (IMAP + ikke-blokerende CalDAV discovery)
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

    const aliases = getAliasesForUser(username);

    // Ikke-blokerende CalDAV-tjek, så brugeren altid kommer ind i suiten, selv hvis SOGo DAV er langsom
    let calendars: CalendarInfoDTO[] = [];
    let caldavReady = false;
    try {
      calendars = await fetchCalendars({
        serverUrl: serverCfg.caldavUrl,
        username,
        password
      });
      caldavReady = true;
    } catch (davErr: any) {
      console.warn('CalDAV forhåndstjek ved login fejlede:', davErr?.message || davErr);
    }

    res.json({
      ok: true,
      username,
      folders,
      aliases,
      calendars,
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
