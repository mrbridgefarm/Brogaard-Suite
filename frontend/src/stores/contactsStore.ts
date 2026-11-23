import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { db } from '../db/database';
import { useSuiteStore } from './suiteStore';
import type { AddressBook, Contact } from '../types/contacts';
import {
  apiSyncCardDav,
  apiSaveContact,
  apiDeleteContact,
  apiImportVcf,
  apiExportVcf
} from '../services/carddavApi';

function toPlainObject<T>(val: T): T {
  if (val === null || val === undefined) return val;
  return JSON.parse(JSON.stringify(val)) as T;
}

export const useContactsStore = defineStore('contacts', () => {
  const suiteStore = useSuiteStore();

  const addressBooks = ref<AddressBook[]>([]);
  const contacts = ref<Contact[]>([]);
  const isSyncing = ref(false);
  const isSaving = ref(false);
  const lastSyncedAt = ref<string | null>(null);

  const selectedAddressBookId = ref<string>('ALL');
  const selectedCategory = ref<string>('ALL');
  const searchQuery = ref<string>('');
  const selectedContactId = ref<string | null>(null);

  const editingContact = ref<Contact | null>(null);
  const isContactModalOpen = ref<boolean>(false);

  const writableAddressBooks = computed(() =>
    addressBooks.value.filter((b) => !b.readOnly)
  );

  const defaultWritableAddressBook = computed<AddressBook | undefined>(
    () => writableAddressBooks.value[0] || addressBooks.value[0]
  );

  const allCategories = computed<Array<{ name: string; count: number }>>(() => {
    const counts = new Map<string, number>();
    for (const c of contacts.value) {
      for (const cat of c.categories || []) {
        const clean = cat.trim();
        if (!clean) continue;
        counts.set(clean, (counts.get(clean) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'da-DK'));
  });

  const contactsWithBirthdaysCount = computed<number>(
    () => contacts.value.filter((c) => Boolean(c.birthday && /^\d{4}-\d{2}-\d{2}/.test(c.birthday))).length
  );

  const filteredContacts = computed<Contact[]>(() => {
    const q = searchQuery.value.trim().toLowerCase();
    return contacts.value
      .filter((c) => {
        if (
          selectedAddressBookId.value !== 'ALL' &&
          c.addressBookId !== selectedAddressBookId.value
        ) {
          return false;
        }
        if (
          selectedCategory.value !== 'ALL' &&
          !(c.categories || []).includes(selectedCategory.value)
        ) {
          return false;
        }
        if (!q) return true;

        const haystack = [
          c.fullName,
          c.firstName,
          c.lastName,
          c.nickname || '',
          c.organization || '',
          c.title || '',
          c.notes || '',
          ...(c.emails || []).map((e) => e.value),
          ...(c.phones || []).map((p) => p.value),
          ...(c.categories || [])
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'da-DK'));
  });

  const selectedContact = computed<Contact | null>(() => {
    if (!selectedContactId.value) return null;
    return contacts.value.find((c) => c.id === selectedContactId.value) || null;
  });

  function getAddressBookById(id: string): AddressBook | undefined {
    return addressBooks.value.find((b) => b.id === id);
  }

  function isAddressBookReadOnly(id: string): boolean {
    return Boolean(getAddressBookById(id)?.readOnly);
  }

  async function hydrateSession() {
    try {
      const [cachedBooks, cachedContacts] = await Promise.all([
        db.addressBooks.toArray(),
        db.contacts.toArray()
      ]);
      if (cachedBooks.length > 0) addressBooks.value = cachedBooks;
      if (cachedContacts.length > 0) contacts.value = cachedContacts;
    } catch {
      // Ignorér IndexedDB fejl
    }

    if (suiteStore.isOnline) {
      await syncWithServer(true);
    }
  }

  async function syncWithServer(silent = false) {
    if (!suiteStore.isAuthenticated || suiteStore.isPublicShareMode) return;
    isSyncing.value = true;
    try {
      const res = await apiSyncCardDav();
      const plainBooks = toPlainObject(res.addressBooks || []);
      const plainContacts = toPlainObject(res.contacts || []);

      addressBooks.value = plainBooks;
      contacts.value = plainContacts;
      lastSyncedAt.value = res.syncedAt;

      await db.transaction('rw', db.addressBooks, db.contacts, async () => {
        await db.addressBooks.clear();
        await db.contacts.clear();
        if (plainBooks.length > 0) await db.addressBooks.bulkPut(plainBooks);
        if (plainContacts.length > 0) await db.contacts.bulkPut(plainContacts);
      });

      if (selectedContactId.value && !plainContacts.some((c) => c.id === selectedContactId.value)) {
        selectedContactId.value = plainContacts[0]?.id || null;
      } else if (!selectedContactId.value && plainContacts.length > 0) {
        selectedContactId.value = plainContacts[0].id;
      }

      if (!silent) {
        suiteStore.notify(
          'Kontakter synkroniseret',
          `Hentede ${plainContacts.length} kontakt(er) fra CardDAV.`,
          'success'
        );
      }
    } catch (err: any) {
      if (!silent) {
        suiteStore.notify(
          'CardDAV synkroniseringsfejl',
          err?.message || 'Kunne ikke kontakte Mailcow CardDAV.',
          'error'
        );
      }
    } finally {
      isSyncing.value = false;
    }
  }

  function openCreateContactModal(prefill?: { fullName?: string; email?: string }) {
    const book = defaultWritableAddressBook.value;
    if (!book || book.readOnly) {
      suiteStore.notify(
        'Ingen skrivbar adressebog',
        'Alle tilgængelige adressebøger er skrivebeskyttede.',
        'warning'
      );
      return;
    }

    const fullName = (prefill?.fullName || '').trim();
    const parts = fullName ? fullName.split(/\s+/) : [];
    const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '';
    const lastName = parts.length > 1 ? parts[parts.length - 1] : '';

    editingContact.value = {
      id: '',
      uid: '',
      addressBookId: book.id,
      fullName,
      firstName,
      lastName,
      nickname: '',
      organization: '',
      title: '',
      emails: prefill?.email
        ? [{ type: 'other', value: prefill.email.trim(), pref: true }]
        : [{ type: 'home', value: '', pref: true }],
      phones: [{ type: 'mobile', value: '', pref: true }],
      birthday: '',
      address: { street: '', city: '', postalCode: '', country: '' },
      website: '',
      notes: '',
      categories: []
    };
    isContactModalOpen.value = true;
  }

  function openEditContactModal(contact: Contact) {
    editingContact.value = toPlainObject({
      ...contact,
      emails: contact.emails.length > 0 ? contact.emails : [{ type: 'home', value: '' }],
      phones: contact.phones.length > 0 ? contact.phones : [{ type: 'mobile', value: '' }],
      address: contact.address || { street: '', city: '', postalCode: '', country: '' },
      categories: contact.categories || []
    });
    isContactModalOpen.value = true;
  }

  async function saveContact(input: Contact): Promise<Contact | null> {
    if (isAddressBookReadOnly(input.addressBookId)) {
      suiteStore.notify('Skrivebeskyttet', 'Adressebogen er skrivebeskyttet.', 'error');
      return null;
    }

    isSaving.value = true;
    try {
      const cleaned: Contact = toPlainObject({
        ...input,
        emails: (input.emails || []).filter((e) => e.value.trim().length > 0),
        phones: (input.phones || []).filter((p) => p.value.trim().length > 0),
        categories: (input.categories || []).map((c) => c.trim()).filter(Boolean)
      });

      const saved = toPlainObject(await apiSaveContact(cleaned));

      if (input.id && input.id !== saved.id) {
        contacts.value = contacts.value.filter((c) => c.id !== input.id);
        await db.contacts.delete(input.id).catch(() => {});
      }

      const idx = contacts.value.findIndex((c) => c.id === saved.id);
      if (idx !== -1) {
        contacts.value[idx] = saved;
      } else {
        contacts.value.push(saved);
      }
      await db.contacts.put(saved).catch(() => {});
      selectedContactId.value = saved.id;
      isContactModalOpen.value = false;

      suiteStore.notify('Kontakt gemt', `"${saved.fullName}" er synkroniseret til Mailcow.`, 'success');
      return saved;
    } catch (err: any) {
      suiteStore.notify(
        'Kunne ikke gemme kontakt',
        err?.message || 'Fejl ved gem på CardDAV-serveren.',
        'error'
      );
      return null;
    } finally {
      isSaving.value = false;
    }
  }

  async function deleteContact(contact: Contact): Promise<boolean> {
    if (isAddressBookReadOnly(contact.addressBookId)) {
      suiteStore.notify('Skrivebeskyttet', 'Adressebogen er skrivebeskyttet.', 'error');
      return false;
    }

    try {
      if (contact.vcardUrl) {
        await apiDeleteContact(contact.vcardUrl, contact.etag);
      }
      contacts.value = contacts.value.filter((c) => c.id !== contact.id);
      await db.contacts.delete(contact.id).catch(() => {});
      if (selectedContactId.value === contact.id) {
        selectedContactId.value = filteredContacts.value[0]?.id || null;
      }
      suiteStore.notify('Kontakt slettet', `"${contact.fullName}" blev slettet fra adressebogen.`, 'info');
      return true;
    } catch (err: any) {
      suiteStore.notify('Kunne ikke slette kontakt', err?.message || 'CardDAV fejl.', 'error');
      return false;
    }
  }

  async function importVcfFile(addressBookId: string, vcfContent: string): Promise<number> {
    if (isAddressBookReadOnly(addressBookId)) {
      suiteStore.notify('Skrivebeskyttet adressebog', 'Vælg en skrivbar adressebog.', 'error');
      return 0;
    }

    const res = await apiImportVcf(addressBookId, vcfContent);
    const plain = toPlainObject(res.contacts);
    for (const c of plain) {
      const idx = contacts.value.findIndex((item) => item.id === c.id);
      if (idx !== -1) {
        contacts.value[idx] = c;
      } else {
        contacts.value.push(c);
      }
    }
    await db.contacts.bulkPut(plain).catch(() => {});
    suiteStore.notify(
      'Kontakter importeret (.vcf)',
      `Importerede ${res.importedCount} kontakt(er) til Mailcow.`,
      'success'
    );
    return res.importedCount;
  }

  async function exportContactsVcf(list?: Contact[]): Promise<void> {
    const targets = toPlainObject(list && list.length > 0 ? list : filteredContacts.value);
    if (targets.length === 0) {
      suiteStore.notify('Ingen kontakter', 'Der er ingen kontakter at eksportere.', 'warning');
      return;
    }
    const vcfContent = await apiExportVcf(targets);
    const blob = new Blob([vcfContent], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const datePart = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `brogaard-kontakter-${datePart}.vcf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    suiteStore.notify(
      'Kontakter eksporteret (.vcf)',
      `Downloadede ${targets.length} kontakt(er) som vCard.`,
      'success'
    );
  }

  function hasContactWithEmail(email: string): boolean {
    const clean = email.trim().toLowerCase();
    if (!clean) return false;
    return contacts.value.some((c) =>
      (c.emails || []).some((e) => e.value.trim().toLowerCase() === clean)
    );
  }

  function searchContactsForAutocomplete(
    query: string,
    limit = 8
  ): Array<{ name: string; email: string; organization?: string }> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const results: Array<{ name: string; email: string; organization?: string }> = [];
    const seenEmails = new Set<string>();

    for (const c of contacts.value) {
      for (const em of c.emails || []) {
        const addr = em.value.trim();
        if (!addr || seenEmails.has(addr.toLowerCase())) continue;

        const haystack = `${c.fullName} ${c.nickname || ''} ${c.organization || ''} ${addr}`.toLowerCase();
        if (haystack.includes(q)) {
          seenEmails.add(addr.toLowerCase());
          results.push({
            name: c.fullName,
            email: addr,
            organization: c.organization
          });
          if (results.length >= limit) return results;
        }
      }
    }

    return results;
  }

  function resetState() {
    addressBooks.value = [];
    contacts.value = [];
    selectedAddressBookId.value = 'ALL';
    selectedCategory.value = 'ALL';
    searchQuery.value = '';
    selectedContactId.value = null;
    editingContact.value = null;
    isContactModalOpen.value = false;
  }

  return {
    addressBooks,
    contacts,
    isSyncing,
    isSaving,
    lastSyncedAt,
    selectedAddressBookId,
    selectedCategory,
    searchQuery,
    selectedContactId,
    editingContact,
    isContactModalOpen,
    writableAddressBooks,
    defaultWritableAddressBook,
    allCategories,
    contactsWithBirthdaysCount,
    filteredContacts,
    selectedContact,
    getAddressBookById,
    isAddressBookReadOnly,
    hydrateSession,
    syncWithServer,
    openCreateContactModal,
    openEditContactModal,
    saveContact,
    deleteContact,
    importVcfFile,
    exportContactsVcf,
    hasContactWithEmail,
    searchContactsForAutocomplete,
    resetState
  };
});
