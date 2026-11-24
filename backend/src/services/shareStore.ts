import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { CalDavCredentials } from './davClient.js';
import {
  getWritableDataDir,
  getCandidateDataDirs,
  encryptText,
  decryptText
} from './cryptoStore.js';

export interface ShareRecord {
  token: string;
  label: string;
  calendarUrls: string[];
  calendarNames: string[];
  serverUrl: string;
  username: string;
  encryptedPassword: string;
  hideDetails: boolean;
  createdAt: string;
}

export interface SharePublicInfo {
  token: string;
  label: string;
  calendarUrls: string[];
  calendarNames: string[];
  hideDetails: boolean;
  createdAt: string;
}

let memoryShares: ShareRecord[] | null = null;

function readAllShares(): ShareRecord[] {
  if (memoryShares !== null) {
    return [...memoryShares];
  }
  for (const dir of getCandidateDataDirs()) {
    const sharesFile = path.join(dir, 'shares.json');
    try {
      if (fs.existsSync(sharesFile)) {
        const raw = fs.readFileSync(sharesFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          memoryShares = parsed;
          return [...memoryShares];
        }
      }
    } catch {
      // Ignorér læsefejl
    }
  }
  memoryShares = [];
  return [];
}

function writeAllShares(records: ShareRecord[]) {
  memoryShares = [...records];
  try {
    const sharesFile = path.join(getWritableDataDir(), 'shares.json');
    fs.writeFileSync(sharesFile, JSON.stringify(records, null, 2), 'utf8');
  } catch (err) {
    console.warn('Kunne ikke skrive shares.json til disk (bevares i hukommelse):', err);
  }
}

export function listSharesForUser(username: string): SharePublicInfo[] {
  const norm = username.toLowerCase().trim();
  return readAllShares()
    .filter((s) => s.username.toLowerCase().trim() === norm)
    .map((s) => ({
      token: s.token,
      label: s.label,
      calendarUrls: s.calendarUrls,
      calendarNames: s.calendarNames,
      hideDetails: Boolean(s.hideDetails),
      createdAt: s.createdAt
    }));
}

export function createShareLink(params: {
  creds: CalDavCredentials;
  label: string;
  calendarUrls: string[];
  calendarNames: string[];
  hideDetails?: boolean;
}): SharePublicInfo {
  const all = readAllShares();
  const token = crypto.randomBytes(18).toString('base64url');
  const record: ShareRecord = {
    token,
    label: params.label.trim() || 'Delt kalender',
    calendarUrls: params.calendarUrls,
    calendarNames: params.calendarNames,
    serverUrl: params.creds.serverUrl,
    username: params.creds.username,
    encryptedPassword: encryptText(params.creds.password),
    hideDetails: Boolean(params.hideDetails),
    createdAt: new Date().toISOString()
  };
  all.push(record);
  writeAllShares(all);

  return {
    token: record.token,
    label: record.label,
    calendarUrls: record.calendarUrls,
    calendarNames: record.calendarNames,
    hideDetails: record.hideDetails,
    createdAt: record.createdAt
  };
}

export function deleteShareLink(username: string, token: string): boolean {
  const norm = username.toLowerCase().trim();
  const all = readAllShares();
  const filtered = all.filter(
    (s) => !(s.token === token && s.username.toLowerCase().trim() === norm)
  );
  if (filtered.length === all.length) return false;
  writeAllShares(filtered);
  return true;
}

export function resolveShareToken(token: string): {
  record: ShareRecord;
  creds: CalDavCredentials;
} | null {
  const found = readAllShares().find((s) => s.token === token);
  if (!found) return null;
  try {
    const password = decryptText(found.encryptedPassword);
    return {
      record: found,
      creds: {
        serverUrl: found.serverUrl,
        username: found.username,
        password
      }
    };
  } catch {
    return null;
  }
}

export function refreshPublicShareOwnerPassword(username: string, newPassword: string): void {
  const norm = username.toLowerCase().trim();
  if (!norm || !newPassword) return;
  const all = readAllShares();
  let changed = false;
  const updated = all.map((s) => {
    if (s.username.toLowerCase().trim() === norm) {
      changed = true;
      return {
        ...s,
        encryptedPassword: encryptText(newPassword)
      };
    }
    return s;
  });
  if (changed) {
    writeAllShares(updated);
  }
}
