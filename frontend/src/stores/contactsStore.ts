import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { db } from '../db/database';
import { useSuiteStore } from './suiteStore';
import type { AddressBook, Contact } from '../types/contacts';
import {
  apiSyncCardDav,
  apiSaveContact,
  apiToggleContactFavorite,
  apiSaveContactCalendarColor,
  apiDeleteContact,
  apiImportVcf,
  apiExportVcf
} from '../services/carddavApi';

export const DEFAULT_CONTACT_CALENDAR_COLOR = '#ec4899';
const CONTACT_CAL_COLOR_STORAGE_KEY = 'brogaard_contact_calendar_color_v1';

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
  const contactCalendarColor = ref<string>(
    localStorage.getItem(CONTACT_CAL_COLOR_STORAGE_KEY) || DEFAULT_CONTACT_CALENDAR_COLOR
  );

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

  const contactsWithAnniversariesCount = computed<number>(
    () => contacts.value.filter((c) => Boolean(c.anniversary && /^\d{4}-\d{2}-\d{2}/.test(c.anniversary))).length
  );

  const contactsWithSpecialDatesCount = computed<number>(
    () =>
      contacts.value.filter(
        (c) =>
          Boolean(c.birthday && /^\d{4}-\d{2}-\d{2}/.test(c.birthday)) ||
          Boolean(c.anniversary && /^\d{4}-\d{2}-\d{2}/.test(c.anniversary))
      ).length
  );

  const favoritesCount = computed<number>(
    () => contacts.value.filter((c) => Boolean(c.starred)).length
  );

  const filteredContacts = computed<Contact[]>(() => {
    const q = searchQuery.value.trim().toLowerCase();
    return contacts.value
      .filter((c) => {
        if (selectedAddressBookId.value === 'FAVORITES') {
          if (!c.starred) return false;
        } else if (
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
      if (res.calendarColor && /^#[0-9a-fA-F]{6}$/.test(res.calendarColor)) {
        contactCalendarColor.value = res.calendarColor.toLowerCase();
        localStorage.setItem(CONTACT_CAL_COLOR_STORAGE_KEY, contactCalendarColor.value);
      } else if (res.calendarColor === null) {
        contactCalendarColor.value = DEFAULT_CONTACT_CALENDAR_COLOR;
        localStorage.removeItem(CONTACT_CAL_COLOR_STORAGE_KEY);
      }

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
      anniversary: '',
      anniversaryLabel: 'Bryllupsdag',
      address: { street: '', city: '', postalCode: '', country: '' },
      website: '',
      notes: '',
      categories: [],
      starred: selectedAddressBookId.value === 'FAVORITES',
      photoDataUrl: undefined
    };
    isContactModalOpen.value = true;
  }

  function openEditContactModal(contact: Contact) {
    editingContact.value = toPlainObject({
      ...contact,
      emails: contact.emails.length > 0 ? contact.emails : [{ type: 'home', value: '' }],
      phones: contact.phones.length > 0 ? contact.phones : [{ type: 'mobile', value: '' }],
      anniversary: contact.anniversary || '',
      anniversaryLabel: contact.anniversaryLabel || 'Bryllupsdag',
      address: contact.address || { street: '', city: '', postalCode: '', country: '' },
      categories: contact.categories || [],
      starred: Boolean(contact.starred)
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

  async function toggleFavorite(contact: Contact): Promise<void> {
    const idx = contacts.value.findIndex((c) => c.id === contact.id);
    if (idx === -1) return;

    const prevStarred = Boolean(contacts.value[idx].starred);
    const nextStarred = !prevStarred;

    const optimistic: Contact = toPlainObject({
      ...contacts.value[idx],
      starred: nextStarred
    });
    contacts.value[idx] = optimistic;
    await db.contacts.put(optimistic).catch(() => {});

    try {
      const canWriteVcard = !isAddressBookReadOnly(optimistic.addressBookId);
      const res = await apiToggleContactFavorite(
        optimistic.id,
        nextStarred,
        canWriteVcard ? optimistic : undefined
      );
      if (res.contact) {
        const plainSaved = toPlainObject({ ...res.contact, starred: nextStarred });
        const curIdx = contacts.value.findIndex((c) => c.id === optimistic.id || c.id === plainSaved.id);
        if (curIdx !== -1) {
          contacts.value[curIdx] = plainSaved;
        }
        await db.contacts.put(plainSaved).catch(() => {});
      }
    } catch (err: any) {
      const revertIdx = contacts.value.findIndex((c) => c.id === contact.id);
      if (revertIdx !== -1) {
        const reverted = toPlainObject({ ...contacts.value[revertIdx], starred: prevStarred });
        contacts.value[revertIdx] = reverted;
        await db.contacts.put(reverted).catch(() => {});
      }
      suiteStore.notify(
        'Kunne ikke opdatere favorit',
        err?.message || 'Prøv igen om et øjeblik.',
        'error'
      );
    }
  }

  async function updateContactPhotoQuick(
    contact: Contact,
    photoDataUrl: string | null
  ): Promise<Contact | null> {
    return saveContact({
      ...toPlainObject(contact),
      photoDataUrl
    });
  }

  async function setContactCalendarColor(newColor: string | null): Promise<void> {
    const clean =
      typeof newColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(newColor.trim())
        ? newColor.trim().toLowerCase()
        : null;

    if (clean) {
      contactCalendarColor.value = clean;
      localStorage.setItem(CONTACT_CAL_COLOR_STORAGE_KEY, clean);
    } else {
      contactCalendarColor.value = DEFAULT_CONTACT_CALENDAR_COLOR;
      localStorage.removeItem(CONTACT_CAL_COLOR_STORAGE_KEY);
    }

    if (suiteStore.isAuthenticated && !suiteStore.isPublicShareMode && suiteStore.isOnline) {
      try {
        await apiSaveContactCalendarColor(clean);
      } catch {
        // Bevares lokalt ved midlertidig netværksfejl
      }
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

    const prioritized = [...contacts.value].sort(
      (a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred))
    );

    for (const c of prioritized) {
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

  function navigateSelection(delta: 1 | -1) {
    const list = filteredContacts.value;
    if (list.length === 0) return;

    const currentIdx = selectedContactId.value
      ? list.findIndex((c) => c.id === selectedContactId.value)
      : -1;
    const nextIdx =
      currentIdx === -1
        ? delta > 0
          ? 0
          : list.length - 1
        : Math.max(0, Math.min(list.length - 1, currentIdx + delta));
    const target = list[nextIdx];
    if (target) {
      selectedContactId.value = target.id;
    }
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
    navigateSelection,
    editingContact,
    isContactModalOpen,
    writableAddressBooks,
    defaultWritableAddressBook,
    allCategories,
    contactsWithBirthdaysCount,
    contactsWithAnniversariesCount,
    contactsWithSpecialDatesCount,
    contactCalendarColor,
    favoritesCount,
    filteredContacts,
    selectedContact,
    getAddressBookById,
    isAddressBookReadOnly,
    hydrateSession,
    syncWithServer,
    openCreateContactModal,
    openEditContactModal,
    saveContact,
    toggleFavorite,
    updateContactPhotoQuick,
    setContactCalendarColor,
    deleteContact,
    importVcfFile,
    exportContactsVcf,
    hasContactWithEmail,
    searchContactsForAutocomplete,
    resetState
  };
});
