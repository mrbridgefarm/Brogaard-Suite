<script setup lang="ts">
import { ExternalLink, LogOut } from 'lucide-vue-next';
import { useSuiteStore } from '../../stores/suiteStore';

const suiteStore = useSuiteStore();
</script>

<template>
  <div class="flex items-center gap-1.5 shrink-0">
    <a
      v-if="suiteStore.sogoUrl"
      :href="suiteStore.sogoUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-700 bg-slate-800/85 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
      title="Åbn klassisk SOGo webmail/kalender i ny fane"
    >
      <ExternalLink class="w-3.5 h-3.5 text-sky-400" />
      <span class="hidden 2xl:inline">SOGo</span>
    </a>

    <button
      type="button"
      class="p-2 rounded-lg border border-slate-700 bg-slate-800/85 hover:bg-rose-500/20 hover:border-rose-500/40 text-slate-300 hover:text-rose-300 transition"
      :title="`Log ud (${suiteStore.username})`"
      aria-label="Log ud af Brogaard Suite"
      @click="suiteStore.logout()"
    >
      <LogOut class="w-3.5 h-3.5" />
    </button>
  </div>
</template>
