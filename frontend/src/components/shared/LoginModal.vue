<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import {
  Globe,
  X,
  AlertCircle,
  ExternalLink,
  Mail,
  Calendar,
  Users,
  Eye,
  EyeOff
} from 'lucide-vue-next';
import { useSuiteStore } from '../../stores/suiteStore';
import { useTheme } from '../../composables/useTheme';

const suiteStore = useSuiteStore();
const { currentTheme } = useTheme();

const username = ref('');
const password = ref('');
const showPassword = ref(false);
const customServerHost = ref('');
const showCustomServerField = ref(false);
const errorMsg = ref('');
const now = ref(new Date());

let clockTimer: ReturnType<typeof setInterval> | null = null;

const greetingTitle = computed(() => {
  const hour = now.value.getHours();
  if (hour >= 5 && hour < 10) return 'Godmorgen';
  if (hour >= 10 && hour < 12) return 'God formiddag';
  if (hour >= 12 && hour < 18) return 'God eftermiddag';
  return 'Godaften';
});

const dateEyebrow = computed(() => {
  const dt = now.value;
  const weekday = dt.toLocaleDateString('da-DK', { weekday: 'long' }).replace(/\.$/, '');
  const dayMonth = dt.toLocaleDateString('da-DK', { day: 'numeric', month: 'long' });
  return `${weekday} · ${dayMonth}`;
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
    showPassword.value = false;
  } catch (err: any) {
    errorMsg.value = err?.message || 'Kunne ikke logge ind. Kontrollér e-mail og adgangskode.';
  }
}

function tryClose() {
  if (canCloseModal.value) {
    showPassword.value = false;
    suiteStore.isLoginModalOpen = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="suiteStore.isLoginModalOpen || (!suiteStore.isAuthenticated && !suiteStore.isPublicShareMode)"
      class="fixed inset-0 z-50 flex flex-col justify-center overflow-y-auto bg-slate-950"
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

      <!-- Diskret luk-knap hvis modal åbnes mens brugeren allerede er logget ind -->
      <button
        v-if="canCloseModal"
        type="button"
        class="fixed top-5 right-6 z-20 p-2 rounded-xl bg-black/35 hover:bg-black/55 border border-white/15 text-white/80 hover:text-white backdrop-blur-md transition"
        title="Luk"
        @click="tryClose"
      >
        <X class="w-4 h-4" />
      </button>

      <!-- Centreret branding + frostet krystalglas-panel -->
      <main class="relative z-10 px-4 py-10 flex flex-col items-center justify-center my-auto">
        <!-- Elegant centreret Brogaard Suite signatur -->
        <div class="mb-6 flex flex-col items-center select-none">
          <div
            class="relative flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-white/20 via-white/10 to-white/5 backdrop-blur-xl border border-white/25 shadow-[0_12px_32px_-6px_rgba(0,0,0,0.5)]"
          >
            <span
              aria-hidden="true"
              class="pointer-events-none absolute inset-x-2 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent"
            ></span>
            <svg
              class="w-6 h-6 drop-shadow"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <rect
                x="4"
                y="6.5"
                width="24"
                height="19"
                rx="4.5"
                stroke="white"
                stroke-opacity="0.92"
                stroke-width="1.75"
              />
              <path
                d="M5.5 9L16 17L26.5 9"
                stroke="white"
                stroke-opacity="0.95"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <circle cx="11.5" cy="21.5" r="1.4" fill="#7dd3fc" />
              <circle cx="16" cy="21.5" r="1.4" fill="#a5b4fc" />
              <circle cx="20.5" cy="21.5" r="1.4" fill="#6ee7b7" />
            </svg>
          </div>

          <div class="mt-3.5 flex items-center gap-3">
            <span
              aria-hidden="true"
              class="h-px w-8 bg-gradient-to-r from-transparent to-white/40"
            ></span>
            <span class="text-[14px] tracking-[0.24em] uppercase text-white/95 drop-shadow">
              <span class="font-semibold">Brogaard</span>
              <span class="font-light text-sky-200/90 ml-1.5">Suite</span>
            </span>
            <span
              aria-hidden="true"
              class="h-px w-8 bg-gradient-to-l from-transparent to-white/40"
            ></span>
          </div>
        </div>

        <div
          class="dav-login-card relative overflow-hidden w-full max-w-[400px] rounded-2xl px-7 py-8 shadow-2xl border transition-all duration-300"
          :class="
            currentTheme.wallpaper
              ? 'backdrop-blur-md backdrop-saturate-150 border-white/25'
              : 'backdrop-blur-xl'
          "
          :style="{
            background: currentTheme.loginCard,
            ...(currentTheme.wallpaper ? {} : { borderColor: currentTheme.border })
          }"
        >
          <!-- Subtilt lysrefleks / glasglans overlay -->
          <div
            v-if="currentTheme.wallpaper"
            aria-hidden="true"
            class="pointer-events-none absolute inset-0 rounded-2xl"
            style="background: linear-gradient(135deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.03) 45%, rgba(255, 255, 255, 0.07) 100%)"
          ></div>

          <div class="relative z-10">
            <div class="text-center">
              <p class="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-200/75 drop-shadow-sm">
                {{ dateEyebrow }}
              </p>
              <h1 class="text-2xl font-bold text-white tracking-tight drop-shadow mt-1">
                {{ greetingTitle }}
              </h1>

              <!-- Nordiske glas-badges for aktive moduler -->
              <div class="mt-3.5 flex flex-wrap items-center justify-center gap-1.5">
                <span
                  v-if="suiteStore.isAnyModuleEnabled('mail')"
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 border border-white/15 backdrop-blur-md text-[11px] font-medium text-slate-100/95 shadow-sm"
                >
                  <Mail class="w-3 h-3 text-sky-300/95 shrink-0" />
                  <span>Mail</span>
                </span>
                <span
                  v-if="suiteStore.isAnyModuleEnabled('calendar')"
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 border border-white/15 backdrop-blur-md text-[11px] font-medium text-slate-100/95 shadow-sm"
                >
                  <Calendar class="w-3 h-3 text-indigo-300/95 shrink-0" />
                  <span>Kalender</span>
                </span>
                <span
                  v-if="suiteStore.isAnyModuleEnabled('contacts')"
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 border border-white/15 backdrop-blur-md text-[11px] font-medium text-slate-100/95 shadow-sm"
                >
                  <Users class="w-3 h-3 text-emerald-300/95 shrink-0" />
                  <span>Kontakter</span>
                </span>
              </div>
            </div>

            <form class="mt-6 space-y-4 text-xs" @submit.prevent="handleLogin">
              <div
                v-if="errorMsg"
                class="p-3 rounded-xl bg-rose-500/20 backdrop-blur-sm border border-rose-400/40 text-rose-100 flex items-start gap-2"
              >
                <AlertCircle class="w-4 h-4 shrink-0 mt-0.5" />
                <span>{{ errorMsg }}</span>
              </div>

              <div>
                <label
                  for="suite-login-email"
                  class="block text-slate-100 font-medium text-[12px] mb-1.5 drop-shadow-sm"
                >
                  E-mailadresse
                </label>
                <input
                  id="suite-login-email"
                  v-model="username"
                  type="email"
                  name="username"
                  autocomplete="username"
                  required
                  autofocus
                  placeholder="bruger@domæne.dk"
                  class="w-full px-3.5 py-2.5 bg-black/20 backdrop-blur-sm border border-white/20 rounded-xl text-sm text-white placeholder-slate-200/65 focus:outline-none focus:bg-black/30 focus:border-white/45 transition"
                />
              </div>

              <!-- Vises kun hvis DEFAULT_MAIL_HOST ikke er konfigureret i .env -->
              <div v-if="showCustomServerField" class="p-3 rounded-xl bg-black/20 backdrop-blur-sm border border-white/15 space-y-1.5">
                <label
                  for="suite-login-server"
                  class="flex items-center gap-1.5 text-slate-100 font-medium"
                >
                  <Globe class="w-3.5 h-3.5 opacity-80" /> Mailcow Server (IMAP, SMTP &amp; DAV vært)
                </label>
                <input
                  id="suite-login-server"
                  v-model="customServerHost"
                  type="text"
                  required
                  placeholder="f.eks. mail.ditdomæne.dk"
                  class="w-full px-3 py-2 bg-black/25 border border-white/20 rounded-xl text-slate-100 placeholder-slate-200/65 focus:outline-none focus:bg-black/35 focus:border-white/45 transition"
                />
              </div>

              <div>
                <label
                  for="suite-login-password"
                  class="block text-slate-100 font-medium text-[12px] mb-1.5 drop-shadow-sm"
                >
                  Adgangskode
                </label>
                <div class="relative">
                  <input
                    id="suite-login-password"
                    v-model="password"
                    :type="showPassword ? 'text' : 'password'"
                    name="password"
                    autocomplete="current-password"
                    required
                    placeholder="••••••••••••••••"
                    class="suite-pwd-input w-full pl-3.5 pr-10 py-2.5 bg-black/20 backdrop-blur-sm border border-white/20 rounded-xl text-sm text-white placeholder-slate-200/70 focus:outline-none focus:bg-black/30 focus:border-white/45 transition"
                  />
                  <button
                    type="button"
                    :aria-label="showPassword ? 'Skjul adgangskode' : 'Vis adgangskode'"
                    :aria-pressed="showPassword"
                    :title="showPassword ? 'Skjul adgangskode' : 'Vis adgangskode'"
                    class="absolute inset-y-0 right-0 px-3 flex items-center text-slate-200/70 hover:text-white focus:outline-none transition"
                    @click="showPassword = !showPassword"
                  >
                    <EyeOff v-if="showPassword" class="w-4 h-4" />
                    <Eye v-else class="w-4 h-4" />
                  </button>
                </div>
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
              class="mt-5 pt-4 border-t border-white/15 text-center"
            >
              <a
                :href="suiteStore.sogoUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1.5 text-[11px] text-slate-200/90 hover:text-white transition"
              >
                <span>Foretrækker du klassisk SOGo? Åbn SOGo</span>
                <ExternalLink class="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  </Teleport>
</template>

<style scoped>
/* Skjul Edge/Windows indbyggede password-øje så der ikke vises to ikoner samtidig */
.suite-pwd-input::-ms-reveal,
.suite-pwd-input::-ms-clear {
  display: none;
}
</style>
