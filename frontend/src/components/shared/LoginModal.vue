<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue';
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
const isLoginBoxOpen = ref(false);
const emailInputRef = ref<HTMLInputElement | null>(null);
const customServerHost = ref('');
const showCustomServerField = ref(false);
const errorMsg = ref('');
const now = ref(new Date());

let clockTimer: ReturnType<typeof setInterval> | null = null;

const isScreenVisible = computed(
  () =>
    suiteStore.isLoginModalOpen || (!suiteStore.isAuthenticated && !suiteStore.isPublicShareMode)
);

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

function focusEmailField() {
  void nextTick(() => {
    emailInputRef.value?.focus();
  });
}

function openLoginBox() {
  isLoginBoxOpen.value = true;
  focusEmailField();
}

function closeLoginBox() {
  if (!isLoginBoxOpen.value) return;
  showPassword.value = false;
  errorMsg.value = '';
  if (canCloseModal.value) {
    suiteStore.isLoginModalOpen = false;
  } else {
    isLoginBoxOpen.value = false;
  }
}

function handleBackdropClick() {
  closeLoginBox();
}

function handleGlobalKeydown(e: KeyboardEvent) {
  if (!isScreenVisible.value) return;
  if (!isLoginBoxOpen.value && (e.key === 'Enter' || e.key === ' ')) {
    const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
    if (tag === 'button' || tag === 'a' || tag === 'input') return;
    e.preventDefault();
    openLoginBox();
  } else if (isLoginBoxOpen.value && e.key === 'Escape') {
    e.preventDefault();
    handleBackdropClick();
  }
}

onMounted(() => {
  clockTimer = setInterval(() => {
    now.value = new Date();
  }, 30000);
  window.addEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
  window.removeEventListener('keydown', handleGlobalKeydown);
});

const canCloseModal = computed(() => suiteStore.isAuthenticated);

watch(
  () =>
    [
      suiteStore.isLoginModalOpen,
      suiteStore.isAuthenticated,
      suiteStore.hasDefaultServer,
      suiteStore.username
    ] as const,
  ([modalOpen, authenticated]) => {
    if (suiteStore.username) {
      username.value = suiteStore.username;
    }
    showCustomServerField.value = !suiteStore.hasDefaultServer;
    if (modalOpen && authenticated) {
      openLoginBox();
    } else if (!authenticated && !modalOpen) {
      isLoginBoxOpen.value = false;
    }
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
    isLoginBoxOpen.value = false;
  } catch (err: any) {
    errorMsg.value = err?.message || 'Kunne ikke logge ind. Kontrollér e-mail og adgangskode.';
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isScreenVisible"
      class="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-slate-950"
      @click.self="handleBackdropClick"
    >
      <!-- Baggrundsbillede + stemningsfuld vignette -->
      <div
        v-if="currentTheme.wallpaper"
        class="fixed inset-0 z-0 pointer-events-none bg-cover bg-center transition-transform duration-700 ease-out"
        :class="isLoginBoxOpen ? 'scale-[1.02]' : 'scale-100'"
        :style="{ backgroundImage: `url(${currentTheme.wallpaper})` }"
      ></div>
      <div
        class="fixed inset-0 z-0 pointer-events-none transition-opacity duration-500"
        :class="isLoginBoxOpen ? 'opacity-100' : 'opacity-65'"
        :style="{ background: currentTheme.loginOverlay }"
      ></div>

      <!-- Stor, ren Brogaard Suite-signatur højt i billedet + krystalglas LOG IND-knap lige under -->
      <header
        class="relative z-20 pt-12 sm:pt-16 pb-4 px-6 flex flex-col items-center justify-center select-none shrink-0"
      >
        <div class="flex items-center gap-4 sm:gap-6 pointer-events-none">
          <span
            aria-hidden="true"
            class="h-px w-10 sm:w-20 bg-gradient-to-r from-transparent via-white/35 to-white/60"
          ></span>
          <span
            class="text-xl sm:text-3xl tracking-[0.28em] uppercase text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.45)]"
          >
            <span class="font-semibold">Brogaard</span>
            <span class="font-extralight text-sky-200/95 ml-2.5 sm:ml-3.5">Suite</span>
          </span>
          <span
            aria-hidden="true"
            class="h-px w-10 sm:w-20 bg-gradient-to-l from-transparent via-white/35 to-white/60"
          ></span>
        </div>

        <!-- Dobbelt-indfattet krystalglas LOG IND-knap (inspireret af bezel/gloss-stil, tilpasset aktivt tema) -->
        <Transition name="suite-pill-fade">
          <button
            v-if="!isLoginBoxOpen"
            type="button"
            aria-label="Åbn login"
            :style="{
              '--suite-btn-accent': currentTheme.accent,
              '--suite-btn-accent-soft': currentTheme.accentSoft
            }"
            class="suite-crystal-bezel group mt-6 p-[3px] rounded-2xl backdrop-blur-xl transition-all duration-300 cursor-pointer focus:outline-none"
            @click="openLoginBox"
          >
            <span
              class="suite-crystal-inner relative block px-9 py-2.5 rounded-[13px] overflow-hidden transition-all duration-300"
            >
              <!-- Skrå glasglans hen over øverste halvdel -->
              <span
                aria-hidden="true"
                class="suite-crystal-gloss pointer-events-none absolute inset-0"
              ></span>
              <!-- Subtilt tema-farvet bundskær -->
              <span
                aria-hidden="true"
                class="pointer-events-none absolute inset-x-3 bottom-0 h-px opacity-85"
                :style="{
                  background: `linear-gradient(90deg, transparent, ${currentTheme.accent}, transparent)`
                }"
              ></span>
              <span
                class="relative z-10 block text-xs sm:text-[13px] font-bold tracking-[0.30em] uppercase text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.65)] pl-[0.30em]"
              >
                Log ind
              </span>
            </span>
          </button>
        </Transition>
      </header>

      <!-- Centreret frostet krystalglas-panel -->
      <main
        class="relative z-10 flex-1 px-4 pb-12 flex items-center justify-center"
        @click.self="handleBackdropClick"
      >
        <Transition name="suite-login-reveal">
          <div
            v-if="isLoginBoxOpen"
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

          <!-- Diskret luk-knap inde i selve glas-kortets hjørne -->
          <button
            type="button"
            aria-label="Skjul loginboks"
            title="Skjul (Esc)"
            class="absolute top-3.5 right-3.5 z-20 p-1.5 rounded-xl text-slate-200/65 hover:text-white hover:bg-white/10 transition cursor-pointer"
            @click="closeLoginBox"
          >
            <X class="w-4 h-4" />
          </button>

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
                  ref="emailInputRef"
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
        </Transition>
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

/* Dobbelt-indfattet krystalglas-knap under Brogaard Suite-titlen */
.suite-crystal-bezel {
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.52) 0%,
    rgba(255, 255, 255, 0.16) 52%,
    rgba(255, 255, 255, 0.34) 100%
  );
  box-shadow:
    0 14px 34px -6px rgba(0, 0, 0, 0.55),
    0 0 26px -4px var(--suite-btn-accent-soft, rgba(71, 118, 173, 0.28)),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
}
.suite-crystal-bezel:hover {
  transform: translateY(-1.5px);
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.68) 0%,
    rgba(255, 255, 255, 0.24) 52%,
    rgba(255, 255, 255, 0.46) 100%
  );
  box-shadow:
    0 18px 40px -6px rgba(0, 0, 0, 0.62),
    0 0 34px -2px var(--suite-btn-accent-soft, rgba(71, 118, 173, 0.42)),
    inset 0 1px 0 rgba(255, 255, 255, 0.85);
}
.suite-crystal-bezel:active {
  transform: translateY(0.5px) scale(0.985);
}
.suite-crystal-inner {
  background:
    radial-gradient(
      120% 95% at 50% 105%,
      var(--suite-btn-accent-soft, rgba(71, 118, 173, 0.32)) 0%,
      transparent 70%
    ),
    linear-gradient(180deg, rgba(15, 23, 42, 0.56) 0%, rgba(6, 11, 22, 0.78) 100%);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.28),
    inset 0 -1px 2px rgba(0, 0, 0, 0.55),
    0 1px 2px rgba(0, 0, 0, 0.65);
}
.suite-crystal-gloss {
  background: linear-gradient(
    173deg,
    rgba(255, 255, 255, 0.26) 0%,
    rgba(255, 255, 255, 0.08) 46%,
    rgba(255, 255, 255, 0) 48.5%
  );
}

.suite-pill-fade-enter-active,
.suite-pill-fade-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}
.suite-pill-fade-enter-from,
.suite-pill-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.96);
}

/* Blød glas-animation når login-boksen åbnes og skjules */
.suite-login-reveal-enter-active {
  transition:
    opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
}
.suite-login-reveal-leave-active {
  transition:
    opacity 0.2s ease-in,
    transform 0.2s ease-in;
}
.suite-login-reveal-enter-from,
.suite-login-reveal-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}
</style>
