import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const PREFERRED_DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const FALLBACK_DATA_DIR = path.join(os.tmpdir(), 'brogaard-suite-data');

let resolvedDataDir: string | null = null;
let cachedSecretKey: Buffer | null = null;

/**
 * Finder en skrivbar datamappe (primært DATA_DIR, med fallback til OS temp hvis volume har begrænsede rettigheder).
 */
export function getWritableDataDir(): string {
  if (resolvedDataDir) return resolvedDataDir;
  for (const dir of [PREFERRED_DATA_DIR, FALLBACK_DATA_DIR]) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const probe = path.join(dir, '.write_probe');
      fs.writeFileSync(probe, 'ok', { mode: 0o600 });
      fs.unlinkSync(probe);
      resolvedDataDir = dir;
      return dir;
    } catch {
      // Prøv fallback-mappe hvis /app/data ejes af root i en eksisterende Docker-volume
    }
  }
  resolvedDataDir = FALLBACK_DATA_DIR;
  return resolvedDataDir;
}

export function getCandidateDataDirs(): string[] {
  return Array.from(new Set([getWritableDataDir(), PREFERRED_DATA_DIR, FALLBACK_DATA_DIR]));
}

function getSecretKey(): Buffer {
  if (cachedSecretKey) return cachedSecretKey;

  const envSecret = (process.env.SESSION_SECRET || process.env.SHARE_SECRET || '').trim();
  if (envSecret) {
    cachedSecretKey = crypto.createHash('sha256').update(envSecret).digest();
    return cachedSecretKey;
  }

  for (const dir of getCandidateDataDirs()) {
    for (const filename of ['.suite_secret', '.session_secret', '.share_secret']) {
      const keyFile = path.join(dir, filename);
      try {
        if (fs.existsSync(keyFile)) {
          const hex = fs.readFileSync(keyFile, 'utf8').trim();
          if (hex.length === 64) {
            cachedSecretKey = Buffer.from(hex, 'hex');
            return cachedSecretKey;
          }
        }
      } catch {
        // Ignorér EACCES
      }
    }
  }

  const newKey = crypto.randomBytes(32);
  cachedSecretKey = newKey;
  try {
    const writableKeyFile = path.join(getWritableDataDir(), '.suite_secret');
    fs.writeFileSync(writableKeyFile, newKey.toString('hex'), { mode: 0o600 });
  } catch {
    // Bevar nøglen i hukommelsen hvis disk-skrivning fejler
  }
  return newKey;
}

export function encryptText(plain: string): string {
  const key = getSecretKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptText(payload: string): string {
  const [ivHex, tagHex, encHex] = payload.split(':');
  if (!ivHex || !tagHex || !encHex) {
    throw new Error('Ugyldigt krypteret format');
  }
  const key = getSecretKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}

export function encryptJson(obj: unknown): string {
  return encryptText(JSON.stringify(obj));
}

export function decryptJson<T>(token: string): T | null {
  try {
    const json = decryptText(token);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
