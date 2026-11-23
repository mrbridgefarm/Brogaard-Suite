import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getWritableDataDir, getCandidateDataDirs } from './cryptoStore.js';

export interface SenderAliasRecord {
  id: string;
  email: string;
  displayName: string;
  signature: string;
  isDefault: boolean;
  createdAt: string;
}

interface UserAliasesFile {
  [usernameLower: string]: SenderAliasRecord[];
}

function readAllAliases(): UserAliasesFile {
  for (const dir of getCandidateDataDirs()) {
    const aliasesFile = path.join(dir, 'aliases.json');
    try {
      if (fs.existsSync(aliasesFile)) {
        const raw = fs.readFileSync(aliasesFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed as UserAliasesFile;
        }
      }
    } catch {
      // Prøv næste mappe
    }
  }
  return {};
}

function writeAllAliases(data: UserAliasesFile) {
  try {
    const aliasesFile = path.join(getWritableDataDir(), 'aliases.json');
    fs.writeFileSync(aliasesFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn('Kunne ikke skrive aliases.json til disk:', err);
  }
}

export function getAliasesForUser(username: string): SenderAliasRecord[] {
  const key = username.toLowerCase().trim();
  const all = readAllAliases();
  const list = Array.isArray(all[key]) ? all[key] : [];

  const hasPrimary = list.some((a) => a.email.toLowerCase().trim() === key);
  if (!hasPrimary && key.includes('@')) {
    const primaryAlias: SenderAliasRecord = {
      id: `primary::${key}`,
      email: username.trim(),
      displayName: '',
      signature: '',
      isDefault: list.length === 0,
      createdAt: new Date().toISOString()
    };
    const updated = [primaryAlias, ...list];
    all[key] = updated;
    writeAllAliases(all);
    return updated;
  }

  return list;
}

export function upsertAliasForUser(
  username: string,
  input: {
    id?: string;
    email: string;
    displayName?: string;
    signature?: string;
    isDefault?: boolean;
  }
): SenderAliasRecord[] {
  const key = username.toLowerCase().trim();
  const emailClean = input.email.trim();
  if (!emailClean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) {
    throw new Error('Ugyldig e-mailadresse for alias.');
  }

  const all = readAllAliases();
  let list = getAliasesForUser(username);

  const existingIdx = list.findIndex(
    (a) =>
      (input.id && a.id === input.id) ||
      a.email.toLowerCase().trim() === emailClean.toLowerCase()
  );

  const shouldBeDefault = Boolean(input.isDefault) || list.length === 0;
  if (shouldBeDefault) {
    list = list.map((a) => ({ ...a, isDefault: false }));
  }

  if (existingIdx >= 0) {
    const existing = list[existingIdx];
    list[existingIdx] = {
      ...existing,
      email: emailClean,
      displayName: input.displayName !== undefined ? input.displayName.trim() : existing.displayName,
      signature: input.signature !== undefined ? input.signature : existing.signature,
      isDefault: shouldBeDefault ? true : existing.isDefault
    };
  } else {
    const record: SenderAliasRecord = {
      id: crypto.randomUUID(),
      email: emailClean,
      displayName: (input.displayName || '').trim(),
      signature: input.signature || '',
      isDefault: shouldBeDefault,
      createdAt: new Date().toISOString()
    };
    list.push(record);
  }

  if (!list.some((a) => a.isDefault) && list.length > 0) {
    list[0].isDefault = true;
  }

  all[key] = list;
  writeAllAliases(all);
  return list;
}

export function deleteAliasForUser(username: string, aliasId: string): SenderAliasRecord[] {
  const key = username.toLowerCase().trim();
  const all = readAllAliases();
  let list = getAliasesForUser(username);

  const target = list.find((a) => a.id === aliasId);
  if (!target) {
    return list;
  }

  if (target.email.toLowerCase().trim() === key && list.length <= 1) {
    throw new Error('Hovedadressen kan ikke fjernes, når der ikke er andre aliaser.');
  }

  list = list.filter((a) => a.id !== aliasId);
  if (!list.some((a) => a.isDefault) && list.length > 0) {
    list[0].isDefault = true;
  }

  all[key] = list;
  writeAllAliases(all);
  return list;
}
