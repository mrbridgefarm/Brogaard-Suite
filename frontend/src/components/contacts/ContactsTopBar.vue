<script setup lang="ts">
import {
  Users,
  Search,
  RefreshCw,
  Wifi,
  WifiOff,
  Plus,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Upload,
  Download
} from 'lucide-vue-next';
import { useContactsStore } from '../../stores/contactsStore';
import { useSuiteStore } from '../../stores/suiteStore';
import { useTheme } from '../../composables/useTheme';
import ThemePicker from '../shared/ThemePicker.vue';

const props = defineProps<{
  sidebarCollapsed: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle-sidebar'): void;
}>();

const store = useContactsStore();
const suiteStore = useSuiteStore();
const { currentTheme } = useTheme();

async function handleVcfUpload(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  const targetBook = store.defaultWritableAddressBook;
  if (!targetBook || targetBook.readOnly) {
    suiteStore.notify(
      'Ingen skrivbar adressebog',
      'Kan ikke importere, da der ikke findes en skrivbar adressebog.',
      'warning'
    );
    return;
  }

  try {
    const text = await file.text();
    await store.importVcfFile(targetBook.id, text);
  } catch (err: any) {
    suiteStore.notify(
      'Import fejlede',
      err?.message || 'Kunne ikke læse .vcf-filen.',
      'error'
    );
  }
}
</script>

<template>
  <header
    class="px-3 sm:px-4 flex items-center justify-between gap-3 select-none relative z-30 transition-all duration-300"
    :class="
      currentTheme.wallpaper
        ? 'mx-2.5 mt-2.5 h-14 rounded-2xl border backdrop-blur-xl shadow-lg'
        : 'h-16 bg-slate-900/95 border-b border-slate-800'
    "
    :style="
      currentTheme.wallpaper
        ? { backgroundColor: currentTheme.surface, borderColor: currentTheme.border }
        : undefined
    "
  >
    <!-- Venstre: Sidebar Toggle & Branding -->
    <div class="flex items-center gap-3">
      <button
        type="button"
        class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
        :title="props.sidebarCollapsed ? 'Vis sidepanel' : 'Skjul sidepanel'"
        @click="emit('toggle-sidebar')"
      >
        <PanelLeftOpen v-if="props.sidebarCollapsed" class="w-4 h-4 text-blue-400" />
        <PanelLeftClose v-else class="w-4 h-4" />
      </button>

      <div class="flex items-center gap-2.5">
        <div class="w-9 h-9 rounded-xl border flex items-center justify-center dav-theme-badge transition-colors">
          <Users class="w-5 h-5" />
        </div>
        <div>
          <div class="font-bold text-slate-100 leading-tight tracking-tight flex items-center gap-2">
            Brogaard Kontakter
            <span
              class="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border transition-colors"
              :class="suiteStore.isOnline
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-300 border-amber-500/30'"
            >
              {{ suiteStore.isOnline ? 'Online' : 'Offline' }}
            </span>
          </div>
          <p class="text-[11px] text-slate-400 hidden sm:block">
            {{ store.contacts.length }} kontakt(er) • CardDAV Sync
          </p>
        </div>
      </div>
    </div>

    <!-- Midt: Øjeblikkelig Lokal Kontaktsøgning -->
    <div class="relative flex-1 max-w-md">
      <div class="relative flex items-center">
        <Search class="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
        <input
          v-model="store.searchQuery"
          type="text"
          placeholder="Søg i kontakter (navn, e-mail, telefon, firma, gruppe)..."
          class="w-full pl-9 pr-8 py-1.5 text-sm rounded-xl text-slate-100 focus:outline-none transition"
          :class="
            currentTheme.wallpaper
              ? 'bg-black/30 border border-white/15 placeholder-slate-300/60 focus:border-white/35 focus:ring-1 focus:ring-white/25'
              : 'bg-slate-950/90 border border-slate-800 placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
          "
        />
        <button
          v-if="store.searchQuery"
          type="button"
          class="absolute right-2.5 text-slate-400 hover:text-slate-200"
          @click="store.searchQuery = ''"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <!-- Højre: vCard Import/Eksport, Tema, Sync & Ny kontakt -->
    <div class="flex items-center gap-1.5 sm:gap-2">
      <label
        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium cursor-pointer transition"
        title="Importér kontakter fra .vcf (vCard) fil"
      >
        <Upload class="w-3.5 h-3.5 text-emerald-400" />
        <span class="hidden md:inline">Importér .vcf</span>
        <input
          type="file"
          accept=".vcf,.vcard,text/vcard"
          class="hidden"
          @change="handleVcfUpload"
        />
      </label>

      <button
        type="button"
        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
        title="Eksportér viste kontakter som .vcf (vCard)"
        @click="store.exportContactsVcf()"
      >
        <Download class="w-3.5 h-3.5 text-blue-400" />
        <span class="hidden md:inline">Eksportér</span>
      </button>

      <ThemePicker variant="topbar" />

      <button
        type="button"
        class="p-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition flex items-center gap-1.5 text-xs"
        :title="suiteStore.isOnline ? 'Synkronisér adressebøger fra Mailcow CardDAV' : 'Offline — Viser cachede kontakter'"
        @click="store.syncWithServer(false)"
      >
        <RefreshCw class="w-3.5 h-3.5" :class="{ 'animate-spin text-blue-400': store.isSyncing }" />
        <Wifi v-if="suiteStore.isOnline" class="w-3.5 h-3.5 text-emerald-400" />
        <WifiOff v-else class="w-3.5 h-3.5 text-amber-400" />
      </button>

      <button
        type="button"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg dav-theme-btn text-xs font-semibold shadow-sm transition"
        @click="store.openCreateContactModal()"
      >
        <Plus class="w-4 h-4" />
        <span class="hidden sm:inline">Ny kontakt</span>
      </button>
    </div>
  </header>
</template>
