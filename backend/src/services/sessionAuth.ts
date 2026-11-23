import type { Request, Response, NextFunction } from 'express';
import { encryptJson, decryptJson } from './cryptoStore.js';
import { resolveServerConfig, type MailServerCredentials } from './mailClient.js';
import { normalizeMailcowUrl, type CalDavCredentials } from './davClient.js';

export type SuiteModule = 'mail' | 'calendar' | 'contacts';

const SESSION_COOKIE_NAME = 'brogaard_suite_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dage

export interface SuiteSessionPayload extends MailServerCredentials {
  caldavUrl: string;
  exp: number;
}

export function createRateLimiter(maxHits: number, windowMs: number, errorMessage: string) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = hits.get(ip);

    if (!record || record.resetAt <= now) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    record.count += 1;
    if (record.count > maxHits) {
      res.status(429).json({ ok: false, error: errorMessage });
      return;
    }

    if (hits.size > 5000) {
      for (const [k, v] of hits.entries()) {
        if (v.resetAt <= now) hits.delete(k);
      }
    }
    next();
  };
}

export function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

export function getSessionFromCookie(req: Request): SuiteSessionPayload | null {
  const cookies = parseCookieHeader(req.headers.cookie);
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken) return null;
  const parsed = decryptJson<SuiteSessionPayload>(rawToken);
  if (!parsed || !parsed.username || !parsed.password || !parsed.imapHost) {
    return null;
  }
  if (typeof parsed.exp === 'number' && parsed.exp < Date.now()) {
    return null;
  }
  return parsed;
}

export function setSessionCookie(
  req: Request,
  res: Response,
  creds: Omit<SuiteSessionPayload, 'exp'>
) {
  const payload: SuiteSessionPayload = {
    ...creds,
    exp: Date.now() + SESSION_TTL_MS
  };
  const encrypted = encryptJson(payload);
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

  res.cookie(SESSION_COOKIE_NAME, encrypted, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    maxAge: SESSION_TTL_MS,
    path: '/api'
  });
}

export function clearSessionCookie(req: Request, res: Response) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/api'
  });
}

export function hasDefaultServerConfigured(): boolean {
  return Boolean(
    (process.env.DEFAULT_MAIL_HOST && process.env.DEFAULT_MAIL_HOST.trim()) ||
      (process.env.DEFAULT_IMAP_HOST && process.env.DEFAULT_IMAP_HOST.trim())
  );
}

export function getEnabledModules(): SuiteModule[] {
  const raw = (process.env.APP_MODULES || 'mail,calendar,contacts')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is SuiteModule => s === 'mail' || s === 'calendar' || s === 'contacts');

  if (raw.length === 0) {
    return ['mail', 'calendar', 'contacts'];
  }
  return Array.from(new Set(raw));
}

export function getConfiguredSogoUrl(): string | null {
  const raw = (process.env.SOGO_URL || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function cleanHostnameFromInput(rawInput?: string): string {
  const clean = (rawInput || '').trim().replace(/^[a-z0-9+.-]+:\/\//i, '').split('/')[0].split(':')[0].trim();
  return clean;
}

export function resolveSuiteServerConfig(input?: {
  serverHost?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  caldavUrl?: string;
}): Omit<SuiteSessionPayload, 'username' | 'password' | 'exp'> {
  const mailCfg = resolveServerConfig(input);

  const customHostClean = cleanHostnameFromInput(input?.serverHost);
  const rawCaldavUrl =
    (input?.caldavUrl || '').trim() ||
    (process.env.DEFAULT_CALDAV_URL || '').trim() ||
    (customHostClean ? `https://${customHostClean}/SOGo/dav/` : '') ||
    (mailCfg.imapHost ? `https://${mailCfg.imapHost}/SOGo/dav/` : '');

  const caldavUrl = normalizeMailcowUrl(rawCaldavUrl);

  return {
    ...mailCfg,
    caldavUrl
  };
}

export function requireMailCredentials(req: Request): MailServerCredentials {
  const session = getSessionFromCookie(req);
  if (session) {
    return {
      imapHost: session.imapHost,
      imapPort: session.imapPort,
      imapSecure: session.imapSecure,
      smtpHost: session.smtpHost,
      smtpPort: session.smtpPort,
      smtpSecure: session.smtpSecure,
      username: session.username,
      password: session.password
    };
  }
  throw new Error('Ikke logget ind. Log venligst ind igen.');
}

export function requireDavCredentials(req: Request): CalDavCredentials {
  const session = getSessionFromCookie(req);
  if (session) {
    const derivedUrl =
      session.caldavUrl ||
      normalizeMailcowUrl(process.env.DEFAULT_CALDAV_URL || `https://${session.imapHost}/SOGo/dav/`);
    return {
      serverUrl: derivedUrl,
      username: session.username,
      password: session.password
    };
  }
  throw new Error('Ikke logget ind. Log venligst ind igen.');
}
