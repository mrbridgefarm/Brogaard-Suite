import type { Request, Response, NextFunction } from 'express';
import net from 'node:net';
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

function normalizeIpCandidate(raw?: string): string | undefined {
  if (!raw) return undefined;
  let clean = raw.trim();
  if (!clean) return undefined;
  if (clean.startsWith('[')) {
    const endBracket = clean.indexOf(']');
    if (endBracket > 1) {
      clean = clean.slice(1, endBracket).trim();
    }
  } else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(clean)) {
    clean = clean.replace(/:\d+$/, '');
  }
  if (/^::ffff:/i.test(clean)) {
    const mapped = clean.slice(7);
    if (net.isIPv4(mapped)) clean = mapped;
  }
  return net.isIP(clean) !== 0 ? clean : undefined;
}

function isPrivateOrLoopbackIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
    return true;
  }
  if (net.isIPv4(lower)) {
    const parts = lower.split('.').map(Number);
    if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  }
  return false;
}

export function extractClientIp(req: Request): string | undefined {
  const remoteIp = normalizeIpCandidate(req.socket?.remoteAddress || '');
  const rawTrust = (process.env.TRUST_PROXY || '').trim().toLowerCase();
  const trustHeaders =
    rawTrust !== 'false' &&
    rawTrust !== '0' &&
    (rawTrust === 'true' || !remoteIp || isPrivateOrLoopbackIp(remoteIp));

  if (trustHeaders) {
    for (const hName of ['cf-connecting-ip', 'true-client-ip', 'x-real-ip']) {
      const hVal = req.headers[hName];
      const rawStr = Array.isArray(hVal) ? hVal[0] : hVal;
      const cand = normalizeIpCandidate(typeof rawStr === 'string' ? rawStr : undefined);
      if (cand) return cand;
    }

    const xff = req.headers['x-forwarded-for'];
    const xffStr = Array.isArray(xff) ? xff.join(',') : xff;
    if (typeof xffStr === 'string' && xffStr.trim()) {
      const candidates = xffStr
        .split(',')
        .map((s) => normalizeIpCandidate(s))
        .filter((ip): ip is string => Boolean(ip));
      const publicIp = candidates.find((ip) => !isPrivateOrLoopbackIp(ip));
      if (publicIp) return publicIp;
      if (candidates.length > 0) return candidates[0];
    }
  }

  return normalizeIpCandidate(req.ip || '') || remoteIp;
}

export function createRateLimiter(maxHits: number, windowMs: number, errorMessage: string) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = extractClientIp(req) || req.ip || req.socket.remoteAddress || 'unknown';
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
  const normalizedInput = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(normalizedInput);
    if (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      (parsed.hostname.includes('.') || parsed.hostname.toLowerCase() === 'localhost')
    ) {
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
      password: session.password,
      clientIp: extractClientIp(req)
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
      password: session.password,
      clientIp: extractClientIp(req)
    };
  }
  throw new Error('Ikke logget ind. Log venligst ind igen.');
}
