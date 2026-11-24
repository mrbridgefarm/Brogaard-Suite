import fs from 'node:fs';
import path from 'node:path';
import { getWritableDataDir, getCandidateDataDirs } from './cryptoStore.js';

export interface UserContactPrefs {
  favoriteContacts: string[];
  unstarredOverrides: string[];
}

type AllContactPrefs = Record<string, UserContactPrefs>;

let memoryPrefs: AllContactPrefs | null = null;

export function canonicalContactPrefKey(rawId: string): string {
  return rawId.trim().toLowerCase();
}

function normalizeList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => canonicalContactPrefKey(item))
    )
  );
}

function normalizePrefsEntry(raw: any): UserContactPrefs {
  return {
    favoriteContacts: normalizeList(raw?.favoriteContacts),
    unstarredOverrides: normalizeList(raw?.unstarredOverrides)
  };
}

function cloneAllPrefs(data: AllContactPrefs): AllContactPrefs {
  const copy: AllContactPrefs = {};
  for (const [userKey, entry] of Object.entries(data)) {
    copy[userKey] = {
      favoriteContacts: [...entry.favoriteContacts],
      unstarredOverrides: [...entry.unstarredOverrides]
    };
  }
  return copy;
}

function readAllPrefs(): AllContactPrefs {
  if (memoryPrefs !== null) {
    return cloneAllPrefs(memoryPrefs);
  }
  for (const dir of getCandidateDataDirs()) {
    const filePath = path.join(dir, 'contact_prefs.json');
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const normalized: AllContactPrefs = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof k === 'string' && k.trim()) {
              normalized[k.toLowerCase().trim()] = normalizePrefsEntry(v);
            }
          }
          memoryPrefs = normalized;
          return cloneAllPrefs(normalized);
        }
      }
    } catch {
      // Ignorér læsefejl
    }
  }
  memoryPrefs = {};
  return {};
}

function writeAllPrefs(data: AllContactPrefs): void {
  memoryPrefs = cloneAllPrefs(data);
  try {
    const filePath = path.join(getWritableDataDir(), 'contact_prefs.json');
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn('Kunne ikke skrive contact_prefs.json til disk (bevares i hukommelse):', err);
  }
}

export function getUserContactPrefs(username: string): UserContactPrefs {
  const all = readAllPrefs();
  const userKey = username.toLowerCase().trim();
  return all[userKey] || { favoriteContacts: [], unstarredOverrides: [] };
}

export function setUserContactFavorite(
  username: string,
  contactId: string,
  starred: boolean
): void {
  const key = canonicalContactPrefKey(contactId);
  if (!key) return;
  const all = readAllPrefs();
  const userKey = username.toLowerCase().trim();
  const current = all[userKey] || { favoriteContacts: [], unstarredOverrides: [] };

  const favSet = new Set(current.favoriteContacts);
  const unstarSet = new Set(current.unstarredOverrides);

  if (starred) {
    favSet.add(key);
    unstarSet.delete(key);
  } else {
    favSet.delete(key);
    unstarSet.add(key);
  }

  all[userKey] = {
    favoriteContacts: Array.from(favSet),
    unstarredOverrides: Array.from(unstarSet)
  };
  writeAllPrefs(all);
}

export function clearUserContactUnstarOverride(username: string, contactId: string): void {
  const key = canonicalContactPrefKey(contactId);
  if (!key) return;
  const all = readAllPrefs();
  const userKey = username.toLowerCase().trim();
  const current = all[userKey];
  if (!current) return;
  const nextUnstar = current.unstarredOverrides.filter((k) => k !== key);
  if (nextUnstar.length !== current.unstarredOverrides.length) {
    all[userKey] = {
      favoriteContacts: current.favoriteContacts,
      unstarredOverrides: nextUnstar
    };
    writeAllPrefs(all);
  }
}
