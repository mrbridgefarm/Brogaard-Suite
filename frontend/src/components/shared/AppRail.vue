<script setup lang="ts">
import { Mail, Calendar, Users, ExternalLink, LogOut } from 'lucide-vue-next';
import { useSuiteStore } from '../../stores/suiteStore';
import { useMailStore } from '../../stores/mailStore';
import { useContactsStore } from '../../stores/contactsStore';
import { useTheme } from '../../composables/useTheme';

const suiteStore = useSuiteStore();
const mailStore = useMailStore();
const contactsStore = useContactsStore();
const { currentTheme } = useTheme();
</script>

<template>
  <nav
    aria-label="Brogaard Suite Moduler"
    class="w-14 sm:w-16 shrink-0 flex flex-col items-center justify-between py-3 select-none relative z-30 transition-all duration-300"
    :class="
      currentTheme.wallpaper
        ? 'my-2.5 ml-2.5 rounded-2xl border backdrop-blur-xl shadow-lg'
        : 'bg-slate-900/95 border-r border-slate-800'
    "
    :style="
      currentTheme.wallpaper
        ? { backgroundColor: currentTheme.surface, borderColor: currentTheme.border }
        : undefined
    "
  >
    <!-- Top: Suite Logo & Primære Moduler -->
    <div class="flex flex-col items-center gap-2.5 w-full px-1.5">
      <div
        class="w-10 h-10 rounded-xl border border-white/15 bg-slate-950/60 flex items-center justify-center shadow mb-1 overflow-hidden"
        :title="`Brogaard Suite (${suiteStore.username})`"
      >
        <img src="/suite-icon.svg" alt="Brogaard Suite" class="w-7 h-7" />
      </div>

      <div class="w-8 h-px bg-white/10 mb-0.5"></div>

      <!-- Mail -->
      <button
        v-if="suiteStore.isAnyModuleEnabled('mail')"
        type="button"
        class="relative w-full py-2 rounded-xl flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition group"
        :class="
          suiteStore.activeModule === 'mail'
            ? 'dav-theme-btn shadow-md'
            : 'text-slate-300/80 hover:text-white hover:bg-white/10'
        "
        title="Mail (Alt+1)"
        @click="suiteStore.setActiveModule('mail')"
      >
        <div class="relative">
          <Mail class="w-5 h-5" />
          <span
            v-if="mailStore.inboxUnreadCount > 0"
            class="absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full bg-rose-500 text-white text-[9.5px] font-bold flex items-center justify-center shadow ring-2 ring-slate-900"
          >
            {{ mailStore.inboxUnreadCount > 99 ? '99+' : mailStore.inboxUnreadCount }}
          </span>
        </div>
        <span class="leading-none">Mail</span>
      </button>

      <!-- Kalender -->
      <button
        v-if="suiteStore.isAnyModuleEnabled('calendar')"
        type="button"
        class="w-full py-2 rounded-xl flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition"
        :class="
          suiteStore.activeModule === 'calendar'
            ? 'dav-theme-btn shadow-md'
            : 'text-slate-300/80 hover:text-white hover:bg-white/10'
        "
        title="Kalender (Alt+2)"
        @click="suiteStore.setActiveModule('calendar')"
      >
        <Calendar class="w-5 h-5" />
        <span class="leading-none">Kalender</span>
      </button>

      <!-- Kontakter -->
      <button
        v-if="suiteStore.isAnyModuleEnabled('contacts')"
        type="button"
        class="w-full py-2 rounded-xl flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition"
        :class="
          suiteStore.activeModule === 'contacts'
            ? 'dav-theme-btn shadow-md'
            : 'text-slate-300/80 hover:text-white hover:bg-white/10'
        "
        :title="`Kontakter (Alt+3) — ${contactsStore.contacts.length} kontakter`"
        @click="suiteStore.setActiveModule('contacts')"
      >
        <Users class="w-5 h-5" />
        <span class="leading-none">Kontakter</span>
      </button>
    </div>

    <!-- Bund: Valgfrit SOGo-skift & Log ud -->
    <div class="flex flex-col items-center gap-2 w-full px-1.5">
      <a
        v-if="suiteStore.sogoUrl"
        :href="suiteStore.sogoUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="w-full py-2 rounded-xl flex flex-col items-center justify-center gap-1 text-[9.5px] font-medium text-slate-300/80 hover:text-white hover:bg-white/10 border border-transparent hover:border-white/10 transition"
        title="Åbn klassisk SOGo webmail/kalender i ny fane"
      >
        <ExternalLink class="w-4 h-4 text-sky-400" />
        <span class="leading-none">SOGo</span>
      </a>

      <button
        type="button"
        class="w-full py-2 rounded-xl flex flex-col items-center justify-center gap-1 text-[9.5px] font-medium text-slate-300/80 hover:text-rose-300 hover:bg-rose-500/15 border border-transparent hover:border-rose-500/30 transition"
        title="Log ud af Brogaard Suite"
        @click="suiteStore.logout()"
      >
        <LogOut class="w-4 h-4" />
        <span class="leading-none">Log ud</span>
      </button>
    </div>
  </nav>
</template>
