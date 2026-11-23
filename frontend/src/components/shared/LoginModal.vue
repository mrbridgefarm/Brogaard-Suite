<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import { Globe, X, AlertCircle, ExternalLink } from 'lucide-vue-next';
import { useSuiteStore } from '../../stores/suiteStore';
import { useTheme } from '../../composables/useTheme';
import ThemePicker from './ThemePicker.vue';

const suiteStore = useSuiteStore();
const { currentTheme } = useTheme();

const username = ref('');
const password = ref('');
const customServerHost = ref('');
const showCustomServerField = ref(false);
const errorMsg = ref('');
const now = ref(new Date());

let clockTimer: ReturnType<typeof setInterval> | null = null;

function getIsoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

const clockLabel = computed(() => {
  const dt = now.value;
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const week = getIsoWeekNumber(dt);
  return `${hh}:${mm} · Uge ${week}`;
});

onMounted(() => {
  clockTimer = setInterval(() => {
    now.value = new Date();
  }, 30000);
});

onUnmounted(() => {
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
});

const canCloseModal = computed(() => suiteStore.isAuthenticated);

watch(
  () => [suiteStore.isLoginModalOpen, suiteStore.hasDefaultServer, suiteStore.username] as const,
  () => {
    if (suiteStore.username) {
      username.value = suiteStore.username;
    }
    showCustomServerField.value = !suiteStore.hasDefaultServer;
  },
  { immediate: true }
);

async function handleLogin() {
  errorMsg.value = '';
  const effectiveCustomHost = !suiteStore.hasDefaultServer ? customServerHost.value.trim() : '';

  if (!effectiveCustomHost && !suiteStore.hasDefaultServer) {
    errorMsg.value = 'Angiv venligst en Mailcow-server (eller sæt DEFAULT_MAIL_HOST i .env).';
    showCustomServerField.value = true;
    return;
  }

  try {
    await suiteStore.login({
      username: username.value.trim(),
      password: password.value,
      serverHost: effectiveCustomHost || undefined
    });
    password.value = '';
  } catch (err: any) {
    errorMsg.value = err?.message || 'Kunne ikke logge ind. Kontrollér e-mail og adgangskode.';
  }
}

function tryClose() {
  if (canCloseModal.value) {
    suiteStore.isLoginModalOpen = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="suiteStore.isLoginModalOpen || (!suiteStore.isAuthenticated && !suiteStore.isPublicShareMode)"
      class="fixed inset-0 z-50 flex flex-col justify-between overflow-y-auto bg-slate-950"
      @click.self="tryClose"
    >
      <!-- Baggrundsbillede + stemningsfuld vignette -->
      <div
        v-if="currentTheme.wallpaper"
        class="fixed inset-0 z-0 pointer-events-none bg-cover bg-center transition-all duration-700"
        :style="{ backgroundImage: `url(${currentTheme.wallpaper})` }"
      ></div>
      <div
        class="fixed inset-0 z-0 pointer-events-none transition-all duration-500"
        :style="{ background: currentTheme.loginOverlay }"
      ></div>

      <!-- Top-bjælke med branding, live ur & temavælger -->
      <header class="relative z-20 px-6 py-5 flex items-center justify-between">
        <div class="flex items-center gap-2.5 text-white/95">
          <img src="/suite-icon.svg" alt="Brogaard Suite" class="w-6 h-6" />
          <span class="text-base font-semibold tracking-tight">Brogaard Suite</span>
        </div>

        <div class="flex items-center gap-3">
          <span class="text-sm text-white/80 font-medium tabular-nums hidden sm:inline">
            {{ clockLabel }}
          </span>
          <ThemePicker variant="floating" />
          <button
            v-if="canCloseModal"
            type="button"
            class="p-1.5 rounded-xl bg-black/35 hover:bg-black/55 border border-white/15 text-white/80 hover:text-white backdrop-blur-md transition"
            title="Luk"
            @click="tryClose"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </header>

      <!-- Centreret røgfarvet glas-panel -->
      <main class="relative z-10 px-4 py-6 flex items-center justify-center">
        <div
          class="dav-login-card w-full max-w-[400px] rounded-2xl px-7 py-8 shadow-2xl backdrop-blur-xl border transition-colors duration-300"
          :style="{
            background: currentTheme.loginCard,
            borderColor: currentTheme.border
          }"
        >
          <div class="text-center">
            <h1 class="text-2xl font-bold text-white tracking-tight">
              Velkommen tilbage
            </h1>
            <p class="text-xs text-slate-300/80 mt-1">
              Log ind på Mail, Kalender &amp; Kontakter
            </p>
          </div>

          <form class="mt-6 space-y-4 text-xs" @submit.prevent="handleLogin">
            <div
              v-if="errorMsg"
              class="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 flex items-start gap-2"
            >
              <AlertCircle class="w-4 h-4 shrink-0 mt-0.5" />
              <span>{{ errorMsg }}</span>
            </div>

            <div>
              <label class="block text-slate-200 font-medium text-[12px] mb-1.5">
                E-mailadresse
              </label>
              <input
                v-model="username"
                type="email"
                required
                autofocus
                placeholder="Indtast mailadresse"
                class="w-full px-3.5 py-2.5 bg-black/30 border border-white/15 rounded-xl text-sm text-white placeholder-slate-400/80 focus:outline-none focus:border-white/40 transition"
              />
            </div>

            <!-- Vises kun hvis DEFAULT_MAIL_HOST ikke er konfigureret i .env -->
            <div v-if="showCustomServerField" class="p-3 rounded-xl bg-black/30 border border-white/10 space-y-1.5">
              <label class="flex items-center gap-1.5 text-slate-200 font-medium">
                <Globe class="w-3.5 h-3.5 opacity-80" /> Mailcow Server (IMAP, SMTP &amp; DAV vært)
              </label>
              <input
                v-model="customServerHost"
                type="text"
                required
                placeholder="f.eks. mail.ditdomæne.dk"
                class="w-full px-3 py-2 bg-black/35 border border-white/15 rounded-xl text-slate-100 placeholder-slate-400 focus:outline-none focus:border-white/40"
              />
            </div>

            <div>
              <label class="block text-slate-200 font-medium text-[12px] mb-1.5">
                Adgangskode
              </label>
              <input
                v-model="password"
                type="password"
                required
                placeholder="••••••••••••••••"
                class="w-full px-3.5 py-2.5 bg-black/30 border border-white/15 rounded-xl text-sm text-white placeholder-slate-400/80 focus:outline-none focus:border-white/40 transition"
              />
            </div>

            <button
              type="submit"
              :disabled="suiteStore.isLoggingIn"
              class="dav-theme-btn w-full py-2.5 rounded-xl font-semibold text-sm shadow-lg transition disabled:opacity-50 mt-2"
            >
              {{ suiteStore.isLoggingIn ? 'Logger ind...' : 'Log ind' }}
            </button>
          </form>

          <!-- Valgfri genvej til klassisk SOGo hvis SOGO_URL er konfigureret -->
          <div
            v-if="suiteStore.sogoUrl"
            class="mt-5 pt-4 border-t border-white/10 text-center"
          >
            <a
              :href="suiteStore.sogoUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 text-[11px] text-slate-300/80 hover:text-white transition"
            >
              <span>Foretrækker du klassisk SOGo? Åbn SOGo</span>
              <ExternalLink class="w-3 h-3" />
            </a>
          </div>
        </div>
      </main>

      <div class="h-10 shrink-0 relative z-10 pointer-events-none"></div>
    </div>
  </Teleport>
</template>
