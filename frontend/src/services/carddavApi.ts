import type { AddressBook, Contact } from '../types/contacts';

export interface CardDavSyncResponse {
  ok: boolean;
  addressBooks: AddressBook[];
  contacts: Contact[];
  syncedAt: string;
  error?: string;
}

export async function apiSyncCardDav(): Promise<CardDavSyncResponse> {
  const res = await fetch('/api/carddav/sync', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Synkronisering med CardDAV-adressebog mislykkedes.');
  }
  return data as CardDavSyncResponse;
}

export async function apiSaveContact(contact: Contact): Promise<Contact> {
  const res = await fetch('/api/carddav/contacts', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ contact })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke gemme kontakten på serveren.');
  }
  return data.contact as Contact;
}

export async function apiDeleteContact(vcardUrl: string, etag?: string): Promise<void> {
  const res = await fetch('/api/carddav/contacts', {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ vcardUrl, etag })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke slette kontakten på serveren.');
  }
}

export async function apiImportVcf(
  addressBookId: string,
  vcfContent: string
): Promise<{ importedCount: number; contacts: Contact[] }> {
  const res = await fetch('/api/carddav/import', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ addressBookId, vcfContent })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke importere .vcf-filen.');
  }
  return {
    importedCount: data.importedCount || 0,
    contacts: data.contacts || []
  };
}

export async function apiExportVcf(contacts: Contact[]): Promise<string> {
  const res = await fetch('/api/carddav/export', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ contacts })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke eksportere kontakter.');
  }
  return data.vcfContent as string;
}
