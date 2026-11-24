<script setup lang="ts">
import { ref } from 'vue';
import {
  Users,
  Star,
  Camera,
  Mail,
  Phone,
  Building2,
  Cake,
  MapPin,
  Globe,
  FileText,
  Tag,
  Pencil,
  Trash2,
  Lock,
  ExternalLink,
  BookUser,
  Plus
} from 'lucide-vue-next';
import ContactsTopBar from './ContactsTopBar.vue';
import { useContactsStore } from '../../stores/contactsStore';
import { useSuiteStore } from '../../stores/suiteStore';
import { useTheme } from '../../composables/useTheme';
import { processContactPhotoFile } from '../../utils/contactPhoto';
import type { Contact } from '../../types/contacts';

const SIDEBAR_WIDTH_KEY = 'brogaard_contacts_sidebar_width_v1';
const LIST_WIDTH_KEY = 'brogaard_contacts_list_width_v1';
const SIDEBAR_COLLAPSED_KEY = 'brogaard_contacts_sidebar_collapsed_v1';

const store = useContactsStore();
const suiteStore = useSuiteStore();
const { currentTheme } = useTheme();

const sidebarCollapsed = ref<boolean>(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true');
const sidebarWidth = ref<number>(
  Math.min(360, Math.max(180, Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)) || 240))
);
const listWidth = ref<number>(
  Math.min(520, Math.max(260, Number(localStorage.getItem(LIST_WIDTH_KEY)) || 340))
);
const isResizing = ref(false);

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed.value));
}

function startResizeSidebar(e: MouseEvent) {
  e.preventDefault();
  isResizing.value = true;
  const startX = e.clientX;
  const startWidth = sidebarWidth.value;

  const onMouseMove = (moveEvent: MouseEvent) => {
    const delta = moveEvent.clientX - startX;
    sidebarWidth.value = Math.min(360, Math.max(180, startWidth + delta));
  };

  const onMouseUp = () => {
    isResizing.value = false;
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value));
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function resetSidebarWidth() {
  sidebarWidth.value = 240;
  localStorage.setItem(SIDEBAR_WIDTH_KEY, '240');
}

function startResizeList(e: MouseEvent) {
  e.preventDefault();
  isResizing.value = true;
  const startX = e.clientX;
  const startWidth = listWidth.value;

  const onMouseMove = (moveEvent: MouseEvent) => {
    const delta = moveEvent.clientX - startX;
    listWidth.value = Math.min(520, Math.max(260, startWidth + delta));
  };

  const onMouseUp = () => {
    isResizing.value = false;
    localStorage.setItem(LIST_WIDTH_KEY, String(listWidth.value));
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function resetListWidth() {
  listWidth.value = 340;
  localStorage.setItem(LIST_WIDTH_KEY, '340');
}

const AVATAR_PALETTE = [
  '#2563eb',
  '#059669',
  '#7c3aed',
  '#db2777',
  '#d97706',
  '#0891b2',
  '#4f46e5',
  '#e11d48'
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function getInitials(contact: Contact): string {
  const parts = contact.fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return (contact.fullName.trim().slice(0, 2) || '?').toUpperCase();
}

function formatBirthdayLabel(bday: string): string {
  const match = bday.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return bday;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(year, month - 1, day);
  const formatted = dt.toLocaleDateString('da-DK', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  const now = new Date();
  let age = now.getFullYear() - year;
  if (
    now.getMonth() + 1 < month ||
    (now.getMonth() + 1 === month && now.getDate() < day)
  ) {
    age--;
  }
  return year >= 1900 && age >= 0 && age <= 130 ? `${formatted} (${age} år)` : formatted;
}

function formatAddressString(contact: Contact): string {
  if (!contact.address) return '';
  return [
    contact.address.street,
    [contact.address.postalCode, contact.address.city].filter(Boolean).join(' '),
    contact.address.country
  ]
    .filter(Boolean)
    .join(', ');
}

function getMapsUrl(contact: Contact): string {
  const q = formatAddressString(contact);
  return q ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}` : '';
}

function getSafeWebsite(url?: string): string {
  if (!url) return '';
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : '';
}

function emailTypeLabel(type: string): string {
  if (type === 'work') return 'Arbejde';
  if (type === 'home') return 'Privat';
  return 'Anden';
}

function phoneTypeLabel(type: string): string {
  if (type === 'mobile') return 'Mobil';
  if (type === 'work') return 'Arbejde';
  if (type === 'home') return 'Privat';
  return 'Anden';
}

function confirmDelete(contact: Contact) {
  const ok = window.confirm(
    `Er du sikker på, at du vil slette kontakten "${contact.fullName}" fra Mailcow?`
  );
  if (ok) {
    void store.deleteContact(contact);
  }
}

function countContactsInBook(bookId: string): number {
  return store.contacts.filter((c) => c.addressBookId === bookId).length;
}

async function handleQuickPhotoChange(e: Event, contact: Contact) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  try {
    const dataUrl = await processContactPhotoFile(file);
    await store.updateContactPhotoQuick(contact, dataUrl);
  } catch (err: any) {
    suiteStore.notify(
      'Kunne ikke indlæse billede',
      err?.message || 'Vælg venligst et gyldigt billede.',
      'error'
    );
  }
}
</script>

<template>
  <div
    class="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden"
    :class="{ 'select-none': isResizing }"
  >
    <ContactsTopBar
      :sidebar-collapsed="sidebarCollapsed"
      @toggle-sidebar="toggleSidebar"
    />

    <div
      class="flex-1 flex min-h-0 overflow-hidden relative z-10"
      :class="currentTheme.wallpaper ? 'px-2.5 pb-2.5 pt-2' : ''"
    >
      <!-- Venstre sidepanel: Adressebøger & Grupper -->
      <template v-if="!sidebarCollapsed">
        <aside
          class="flex flex-col justify-between p-3 select-none overflow-y-auto shrink-0 h-full transition-all duration-300"
          :class="
            currentTheme.wallpaper
              ? 'rounded-2xl border backdrop-blur-xl shadow-lg'
              : 'bg-slate-900/90 border-r border-slate-800'
          "
          :style="{
            width: `${sidebarWidth}px`,
            ...(currentTheme.wallpaper
              ? { backgroundColor: currentTheme.surface, borderColor: currentTheme.border }
              : {})
          }"
        >
          <div class="space-y-5">
            <!-- Adressebøger -->
            <div class="space-y-1.5">
              <div class="flex items-center justify-between px-1">
                <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Adressebøger
                </span>
                <span class="text-[10px] text-slate-500">
                  {{ store.addressBooks.length }}
                </span>
              </div>

              <button
                type="button"
                class="w-full px-2.5 py-2 rounded-xl flex items-center justify-between gap-2 text-xs transition"
                :class="
                  store.selectedAddressBookId === 'ALL'
                    ? 'dav-theme-btn font-semibold shadow-sm'
                    : 'text-slate-200 hover:bg-white/10'
                "
                @click="store.selectedAddressBookId = 'ALL'"
              >
                <span class="flex items-center gap-2 truncate">
                  <Users class="w-3.5 h-3.5 shrink-0" />
                  <span class="truncate">Alle kontakter</span>
                </span>
                <span class="text-[10.5px] opacity-80 shrink-0">{{ store.contacts.length }}</span>
              </button>

              <!-- Separat Favoritter-knap (Starred) -->
              <button
                type="button"
                class="w-full px-2.5 py-2 rounded-xl flex items-center justify-between gap-2 text-xs transition"
                :class="
                  store.selectedAddressBookId === 'FAVORITES'
                    ? 'dav-theme-btn font-semibold shadow-sm'
                    : 'text-slate-200 hover:bg-white/10'
                "
                @click="
                  store.selectedAddressBookId =
                    store.selectedAddressBookId === 'FAVORITES' ? 'ALL' : 'FAVORITES'
                "
              >
                <span class="flex items-center gap-2 truncate">
                  <Star
                    class="w-3.5 h-3.5 shrink-0"
                    :class="
                      store.selectedAddressBookId === 'FAVORITES'
                        ? 'fill-current text-amber-200'
                        : 'fill-amber-400 text-amber-400'
                    "
                  />
                  <span class="truncate">Favoritter</span>
                </span>
                <span class="text-[10.5px] opacity-80 shrink-0">{{ store.favoritesCount }}</span>
              </button>

              <button
                v-for="book in store.addressBooks"
                :key="book.id"
                type="button"
                class="w-full px-2.5 py-2 rounded-xl flex items-center justify-between gap-2 text-xs transition"
                :class="
                  store.selectedAddressBookId === book.id
                    ? 'dav-theme-btn font-semibold shadow-sm'
                    : 'text-slate-200 hover:bg-white/10'
                "
                @click="store.selectedAddressBookId = book.id"
              >
                <span class="flex items-center gap-2 min-w-0">
                  <BookUser class="w-3.5 h-3.5 shrink-0" />
                  <span class="truncate">{{ book.name }}</span>
                  <Lock v-if="book.readOnly" class="w-3 h-3 text-amber-300 shrink-0" title="Skrivebeskyttet" />
                </span>
                <span class="text-[10.5px] opacity-80 shrink-0">{{ countContactsInBook(book.id) }}</span>
              </button>
            </div>

            <!-- Grupper / Kategorier -->
            <div v-if="store.allCategories.length > 0" class="space-y-1.5">
              <div class="flex items-center justify-between px-1">
                <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Grupper &amp; Tags
                </span>
                <button
                  v-if="store.selectedCategory !== 'ALL'"
                  type="button"
                  class="text-[10px] text-blue-400 hover:underline"
                  @click="store.selectedCategory = 'ALL'"
                >
                  Nulstil
                </button>
              </div>

              <div class="flex flex-wrap gap-1.5 px-1">
                <button
                  v-for="cat in store.allCategories"
                  :key="cat.name"
                  type="button"
                  class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border transition"
                  :class="
                    store.selectedCategory === cat.name
                      ? 'dav-theme-btn border-transparent font-semibold'
                      : 'bg-slate-800/70 border-slate-700/70 text-slate-300 hover:bg-slate-800'
                  "
                  @click="
                    store.selectedCategory =
                      store.selectedCategory === cat.name ? 'ALL' : cat.name
                  "
                >
                  <Tag class="w-3 h-3" />
                  <span>{{ cat.name }}</span>
                  <span class="opacity-70 text-[10px]">({{ cat.count }})</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Bund: Fødselsdage-status -->
          <div class="pt-3 border-t border-white/10 space-y-2">
            <div
              v-if="store.contactsWithBirthdaysCount > 0"
              class="p-2.5 rounded-xl bg-pink-500/10 border border-pink-500/25 text-[11px] text-pink-200 flex items-start gap-2"
            >
              <Cake class="w-4 h-4 text-pink-400 shrink-0 mt-0.5" />
              <span>
                <strong>{{ store.contactsWithBirthdaysCount }}</strong> fødselsdag(e) vises automatisk i din kalender.
              </span>
            </div>
          </div>
        </aside>

        <div
          class="cursor-col-resize transition-colors shrink-0 relative"
          :class="currentTheme.wallpaper ? 'w-2 bg-transparent hover:bg-white/15 active:bg-white/25 rounded-full my-2' : 'w-1.5 bg-slate-800/80 hover:bg-blue-500 active:bg-blue-400'"
          title="Træk for at tilpasse sidepanelets bredde (dobbeltklik for standardbredde)"
          @mousedown="startResizeSidebar"
          @dblclick="resetSidebarWidth"
        >
          <div class="absolute inset-y-0 -left-1 -right-1"></div>
        </div>
      </template>

      <!-- Midterste kolonne: Kontaktliste (A-Å) -->
      <section
        class="flex flex-col min-h-0 overflow-hidden shrink-0 transition-all duration-300"
        :class="
          currentTheme.wallpaper
            ? 'rounded-2xl border backdrop-blur-lg shadow-xl'
            : 'bg-slate-900/60 border-r border-slate-800'
        "
        :style="{
          width: `${listWidth}px`,
          ...(currentTheme.wallpaper
            ? { backgroundColor: currentTheme.gridBg, borderColor: currentTheme.border }
            : {})
        }"
      >
        <div
          class="h-11 px-3.5 border-b flex items-center justify-between gap-2 text-xs shrink-0"
          :class="currentTheme.wallpaper ? 'bg-black/25 border-white/10' : 'bg-slate-900/80 border-slate-800'"
        >
          <span class="font-semibold text-slate-200 truncate">
            {{ store.selectedAddressBookId === 'FAVORITES' ? 'Favoritter' : 'Kontakter' }} ({{ store.filteredContacts.length }})
          </span>
          <div class="flex items-center gap-1.5 shrink-0">
            <span v-if="store.selectedCategory !== 'ALL'" class="text-[11px] text-blue-400 truncate max-w-[110px]">
              Tag: {{ store.selectedCategory }}
            </span>
            <button
              type="button"
              class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition"
              :class="
                store.selectedAddressBookId === 'FAVORITES'
                  ? 'bg-amber-500/20 border-amber-400/45 text-amber-200'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
              "
              :title="
                store.selectedAddressBookId === 'FAVORITES'
                  ? 'Vis alle kontakter'
                  : 'Vis kun favorit-kontakter'
              "
              @click="
                store.selectedAddressBookId =
                  store.selectedAddressBookId === 'FAVORITES' ? 'ALL' : 'FAVORITES'
              "
            >
              <Star
                class="w-3 h-3"
                :class="
                  store.selectedAddressBookId === 'FAVORITES' || store.favoritesCount > 0
                    ? 'fill-amber-400 text-amber-400'
                    : 'text-slate-400'
                "
              />
              <span>Favoritter</span>
            </button>
          </div>
        </div>

        <div v-if="store.filteredContacts.length === 0" class="flex-1 flex flex-col items-center justify-center p-6 text-center text-xs text-slate-400 space-y-3">
          <Star v-if="store.selectedAddressBookId === 'FAVORITES'" class="w-8 h-8 text-amber-400/60" />
          <Users v-else class="w-8 h-8 text-slate-600" />
          <p v-if="store.searchQuery">Ingen kontakter matcher "{{ store.searchQuery }}".</p>
          <p v-else-if="store.selectedAddressBookId === 'FAVORITES'">
            Du har ingen favoritter endnu. Klik på stjernen ud for en kontakt for at føje den til Favoritter.
          </p>
          <p v-else>Ingen kontakter fundet i denne adressebog.</p>
          <button
            v-if="store.selectedAddressBookId !== 'FAVORITES'"
            type="button"
            class="px-3 py-1.5 rounded-lg dav-theme-btn text-xs font-semibold flex items-center gap-1.5"
            @click="store.openCreateContactModal()"
          >
            <Plus class="w-3.5 h-3.5" /> Opret ny kontakt
          </button>
        </div>

        <div v-else class="flex-1 overflow-y-auto divide-y divide-white/5">
          <div
            v-for="contact in store.filteredContacts"
            :key="contact.id"
            role="button"
            tabindex="0"
            class="group w-full px-3.5 py-2.5 text-left flex items-center gap-3 transition cursor-pointer focus:outline-none"
            :class="
              store.selectedContactId === contact.id
                ? 'bg-blue-600/20 border-l-2 border-l-blue-400'
                : 'hover:bg-white/5 border-l-2 border-l-transparent'
            "
            @click="store.selectedContactId = contact.id"
            @keydown.enter.prevent="store.selectedContactId = contact.id"
          >
            <div
              class="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white overflow-hidden shadow-sm border border-white/15"
              :style="!contact.photoDataUrl ? { backgroundColor: getAvatarColor(contact.fullName) } : undefined"
            >
              <img
                v-if="contact.photoDataUrl"
                :src="contact.photoDataUrl"
                :alt="contact.fullName"
                class="w-full h-full object-cover"
              />
              <span v-else>{{ getInitials(contact) }}</span>
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-semibold text-slate-100 truncate">
                  {{ contact.fullName }}
                </span>
                <div class="flex items-center gap-1.5 shrink-0">
                  <Cake
                    v-if="contact.birthday"
                    class="w-3 h-3 text-pink-400 shrink-0"
                    :title="`Fødselsdag: ${contact.birthday}`"
                  />
                  <button
                    type="button"
                    class="p-0.5 rounded-md transition"
                    :class="
                      contact.starred
                        ? 'text-amber-400 opacity-100'
                        : 'text-slate-500 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-amber-300'
                    "
                    :title="contact.starred ? 'Fjern fra favoritter' : 'Markér som favorit'"
                    :aria-label="contact.starred ? 'Fjern fra favoritter' : 'Markér som favorit'"
                    @click.stop="store.toggleFavorite(contact)"
                  >
                    <Star
                      class="w-3.5 h-3.5"
                      :class="contact.starred ? 'fill-amber-400 text-amber-400' : ''"
                    />
                  </button>
                </div>
              </div>
              <div class="text-[11px] text-slate-400 truncate">
                {{
                  contact.organization ||
                  contact.emails[0]?.value ||
                  contact.phones[0]?.value ||
                  'Ingen detaljer'
                }}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div
        class="cursor-col-resize transition-colors shrink-0 relative"
        :class="currentTheme.wallpaper ? 'w-2 bg-transparent hover:bg-white/15 active:bg-white/25 rounded-full my-2' : 'w-1.5 bg-slate-800/80 hover:bg-blue-500 active:bg-blue-400'"
        title="Træk for at tilpasse kontaktlistens bredde (dobbeltklik for standardbredde)"
        @mousedown="startResizeList"
        @dblclick="resetListWidth"
      >
        <div class="absolute inset-y-0 -left-1 -right-1"></div>
      </div>

      <!-- Højre kolonne: Kontaktkort -->
      <main
        class="flex-1 flex flex-col min-w-0 h-full overflow-y-auto transition-all duration-300"
        :class="
          currentTheme.wallpaper
            ? 'rounded-2xl border backdrop-blur-lg shadow-xl'
            : 'bg-slate-950'
        "
        :style="
          currentTheme.wallpaper
            ? { backgroundColor: currentTheme.gridBg, borderColor: currentTheme.border }
            : undefined
        "
      >
        <div
          v-if="!store.selectedContact"
          class="flex-1 flex flex-col items-center justify-center p-8 text-center select-none"
        >
          <div class="w-14 h-14 rounded-2xl bg-slate-900/80 border border-white/10 flex items-center justify-center text-slate-500 mb-3">
            <BookUser class="w-7 h-7" />
          </div>
          <h3 class="text-sm font-bold text-slate-200">Vælg en kontakt for at se detaljer</h3>
          <p class="text-xs text-slate-400 mt-1 max-w-sm">
            Alle ændringer synkroniseres automatisk med din Mailcow CardDAV-adressebog og dine mobile enheder.
          </p>
        </div>

        <div v-else class="p-6 max-w-2xl w-full mx-auto space-y-6">
          <!-- Top Profilkort -->
          <div class="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-white/10">
            <div class="flex items-center gap-4 min-w-0">
              <label
                v-if="!store.isAddressBookReadOnly(store.selectedContact.addressBookId)"
                class="group relative w-16 h-16 rounded-2xl shrink-0 flex items-center justify-center text-xl font-bold text-white overflow-hidden shadow-lg border border-white/20 cursor-pointer"
                :style="!store.selectedContact.photoDataUrl ? { backgroundColor: getAvatarColor(store.selectedContact.fullName) } : undefined"
                title="Klik for at uploade eller skifte kontaktbillede"
              >
                <img
                  v-if="store.selectedContact.photoDataUrl"
                  :src="store.selectedContact.photoDataUrl"
                  :alt="store.selectedContact.fullName"
                  class="w-full h-full object-cover"
                />
                <span v-else>{{ getInitials(store.selectedContact) }}</span>
                <span
                  class="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                >
                  <Camera class="w-5 h-5 text-white drop-shadow" />
                </span>
                <input
                  type="file"
                  accept="image/*"
                  class="hidden"
                  @change="handleQuickPhotoChange($event, store.selectedContact)"
                />
              </label>
              <div
                v-else
                class="w-16 h-16 rounded-2xl shrink-0 flex items-center justify-center text-xl font-bold text-white overflow-hidden shadow-lg border border-white/20"
                :style="!store.selectedContact.photoDataUrl ? { backgroundColor: getAvatarColor(store.selectedContact.fullName) } : undefined"
              >
                <img
                  v-if="store.selectedContact.photoDataUrl"
                  :src="store.selectedContact.photoDataUrl"
                  :alt="store.selectedContact.fullName"
                  class="w-full h-full object-cover"
                />
                <span v-else>{{ getInitials(store.selectedContact) }}</span>
              </div>

              <div class="min-w-0 space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <h2 class="text-xl font-bold text-slate-100 truncate">
                    {{ store.selectedContact.fullName }}
                  </h2>
                  <span
                    v-if="store.selectedContact.nickname"
                    class="text-xs text-slate-400"
                  >
                    "{{ store.selectedContact.nickname }}"
                  </span>
                </div>
                <p
                  v-if="store.selectedContact.title || store.selectedContact.organization"
                  class="text-xs text-slate-300 flex items-center gap-1.5"
                >
                  <Building2 class="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>
                    {{ [store.selectedContact.title, store.selectedContact.organization].filter(Boolean).join(' • ') }}
                  </span>
                </p>
                <div v-if="store.selectedContact.categories.length > 0" class="flex flex-wrap gap-1.5 pt-1">
                  <span
                    v-for="cat in store.selectedContact.categories"
                    :key="cat"
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 text-[10.5px] font-medium"
                  >
                    <Tag class="w-2.5 h-2.5" /> {{ cat }}
                  </span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button"
                class="px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition"
                :class="
                  store.selectedContact.starred
                    ? 'bg-amber-500/20 border-amber-400/50 text-amber-200 hover:bg-amber-500/30'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                "
                :title="
                  store.selectedContact.starred ? 'Fjern fra favoritter' : 'Tilføj til favoritter'
                "
                @click="store.toggleFavorite(store.selectedContact)"
              >
                <Star
                  class="w-3.5 h-3.5"
                  :class="
                    store.selectedContact.starred
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-amber-300'
                  "
                />
                <span>{{ store.selectedContact.starred ? 'Favorit' : 'Favorit' }}</span>
              </button>

              <button
                v-if="suiteStore.isAnyModuleEnabled('mail') && store.selectedContact.emails.length > 0"
                type="button"
                class="px-3 py-1.5 rounded-xl dav-theme-btn text-xs font-semibold flex items-center gap-1.5 shadow transition"
                @click="suiteStore.composeMailTo(store.selectedContact.emails[0].value, store.selectedContact.fullName)"
              >
                <Mail class="w-3.5 h-3.5" />
                <span>Send e-mail</span>
              </button>

              <template v-if="!store.isAddressBookReadOnly(store.selectedContact.addressBookId)">
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition"
                  @click="store.openEditContactModal(store.selectedContact)"
                >
                  <Pencil class="w-3.5 h-3.5 text-blue-400" />
                  <span>Redigér</span>
                </button>
                <button
                  type="button"
                  class="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 border border-slate-700 hover:border-rose-500/40 text-slate-300 hover:text-rose-300 transition"
                  title="Slet kontakt"
                  @click="confirmDelete(store.selectedContact)"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </template>
              <span
                v-else
                class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-semibold"
              >
                <Lock class="w-3 h-3" /> Skrivebeskyttet
              </span>
            </div>
          </div>

          <!-- Detaljekort -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <!-- E-mailadresser -->
            <div class="p-4 rounded-2xl bg-black/25 border border-white/10 space-y-2.5">
              <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Mail class="w-3.5 h-3.5 text-blue-400" /> E-mailadresser
              </div>
              <div v-if="store.selectedContact.emails.length === 0" class="text-slate-500">
                Ingen e-mail registreret
              </div>
              <div
                v-for="(em, i) in store.selectedContact.emails"
                :key="i"
                class="flex items-center justify-between gap-2"
              >
                <button
                  v-if="suiteStore.isAnyModuleEnabled('mail')"
                  type="button"
                  class="text-blue-400 hover:text-blue-300 hover:underline font-medium truncate text-left"
                  title="Klik for at sende e-mail"
                  @click="suiteStore.composeMailTo(em.value, store.selectedContact?.fullName)"
                >
                  {{ em.value }}
                </button>
                <span v-else class="text-slate-200 truncate">{{ em.value }}</span>
                <span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] shrink-0">
                  {{ emailTypeLabel(em.type) }}
                </span>
              </div>
            </div>

            <!-- Telefonnumre -->
            <div class="p-4 rounded-2xl bg-black/25 border border-white/10 space-y-2.5">
              <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Phone class="w-3.5 h-3.5 text-emerald-400" /> Telefonnumre
              </div>
              <div v-if="store.selectedContact.phones.length === 0" class="text-slate-500">
                Intet telefonnummer registreret
              </div>
              <div
                v-for="(ph, i) in store.selectedContact.phones"
                :key="i"
                class="flex items-center justify-between gap-2"
              >
                <a
                  :href="`tel:${ph.value}`"
                  class="text-emerald-300 hover:text-emerald-200 hover:underline font-medium truncate"
                >
                  {{ ph.value }}
                </a>
                <span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] shrink-0">
                  {{ phoneTypeLabel(ph.type) }}
                </span>
              </div>
            </div>

            <!-- Fødselsdag -->
            <div
              v-if="store.selectedContact.birthday"
              class="p-4 rounded-2xl bg-black/25 border border-white/10 space-y-1.5"
            >
              <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Cake class="w-3.5 h-3.5 text-pink-400" /> Fødselsdag
              </div>
              <div class="text-slate-100 font-medium">
                {{ formatBirthdayLabel(store.selectedContact.birthday) }}
              </div>
            </div>

            <!-- Adresse -->
            <div
              v-if="formatAddressString(store.selectedContact)"
              class="p-4 rounded-2xl bg-black/25 border border-white/10 space-y-1.5"
            >
              <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span class="flex items-center gap-1.5">
                  <MapPin class="w-3.5 h-3.5 text-rose-400" /> Adresse
                </span>
                <a
                  :href="getMapsUrl(store.selectedContact)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-[10.5px] text-blue-400 hover:underline inline-flex items-center gap-1"
                >
                  Kort <ExternalLink class="w-3 h-3" />
                </a>
              </div>
              <div class="text-slate-200 leading-relaxed">
                {{ formatAddressString(store.selectedContact) }}
              </div>
            </div>

            <!-- Hjemmeside -->
            <div
              v-if="getSafeWebsite(store.selectedContact.website)"
              class="p-4 rounded-2xl bg-black/25 border border-white/10 space-y-1.5 sm:col-span-2"
            >
              <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Globe class="w-3.5 h-3.5 text-sky-400" /> Hjemmeside
              </div>
              <a
                :href="getSafeWebsite(store.selectedContact.website)"
                target="_blank"
                rel="noopener noreferrer"
                class="text-sky-400 hover:underline inline-flex items-center gap-1 break-all"
              >
                <span>{{ getSafeWebsite(store.selectedContact.website) }}</span>
                <ExternalLink class="w-3 h-3 shrink-0" />
              </a>
            </div>
          </div>

          <!-- Noter -->
          <div
            v-if="store.selectedContact.notes"
            class="p-4 rounded-2xl bg-black/25 border border-white/10 space-y-2 text-xs"
          >
            <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <FileText class="w-3.5 h-3.5 text-amber-400" /> Noter
            </div>
            <p class="text-slate-200 whitespace-pre-wrap leading-relaxed">
              {{ store.selectedContact.notes }}
            </p>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
