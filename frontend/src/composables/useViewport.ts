import { ref, computed } from 'vue';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const PWA_BANNER_DISMISSED_KEY = 'brogaard_pwa_hint_dismissed_v1';

const isMobile = ref(false);
const isTablet = ref(false);
const isTouchDevice = ref(false);
const isStandalonePwa = ref(false);
const deferredInstallPrompt = ref<BeforeInstallPromptEvent | null>(null);
const pwaBannerDismissed = ref(
  typeof localStorage !== 'undefined' &&
    localStorage.getItem(PWA_BANNER_DISMISSED_KEY) === 'true'
);

let initialized = false;

function readStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    Boolean(nav.standalone)
  );
}

function initViewportListeners() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  const mobileMq = window.matchMedia('(max-width: 767px)');
  const tabletMq = window.matchMedia('(min-width: 768px) and (max-width: 1023px)');
  const touchMq = window.matchMedia('(pointer: coarse)');
  const standaloneMq = window.matchMedia('(display-mode: standalone)');
  const fullscreenMq = window.matchMedia('(display-mode: fullscreen)');

  const update = () => {
    isMobile.value = mobileMq.matches;
    isTablet.value = tabletMq.matches;
    isTouchDevice.value = touchMq.matches || (window.navigator?.maxTouchPoints || 0) > 0;
    isStandalonePwa.value = readStandalonePwa();
  };

  update();

  mobileMq.addEventListener('change', update);
  tabletMq.addEventListener('change', update);
  touchMq.addEventListener('change', update);
  standaloneMq.addEventListener('change', update);
  fullscreenMq.addEventListener('change', update);

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredInstallPrompt.value = e as BeforeInstallPromptEvent;
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt.value = null;
    isStandalonePwa.value = true;
  });
}

initViewportListeners();

const isIos = computed<boolean>(() => {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  const platform = window.navigator.platform || '';
  return (
    /iPad|iPhone|iPod/i.test(ua) ||
    (platform === 'MacIntel' && (window.navigator.maxTouchPoints || 0) > 1)
  );
});

const canPromptPwaInstall = computed<boolean>(
  () => Boolean(deferredInstallPrompt.value) && !isStandalonePwa.value
);

const showMobilePwaInstallBanner = computed<boolean>(
  () =>
    isMobile.value &&
    !isStandalonePwa.value &&
    !pwaBannerDismissed.value &&
    (canPromptPwaInstall.value || isIos.value)
);

const displayModeLabel = computed<string>(() => {
  if (isStandalonePwa.value) return 'PWA App';
  if (isMobile.value) return 'Mobilbrowser';
  if (isTablet.value) return 'Tablet';
  return 'Desktop';
});

async function triggerPwaInstall(): Promise<boolean> {
  const promptEvent = deferredInstallPrompt.value;
  if (!promptEvent) return false;
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    deferredInstallPrompt.value = null;
    if (choice.outcome === 'accepted') {
      isStandalonePwa.value = true;
      return true;
    }
    return false;
  } catch {
    deferredInstallPrompt.value = null;
    return false;
  }
}

function dismissPwaInstallBanner(): void {
  pwaBannerDismissed.value = true;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(PWA_BANNER_DISMISSED_KEY, 'true');
  }
}

export function useViewport() {
  initViewportListeners();
  return {
    isMobile,
    isTablet,
    isTouchDevice,
    isStandalonePwa,
    isIos,
    canPromptPwaInstall,
    pwaBannerDismissed,
    showMobilePwaInstallBanner,
    displayModeLabel,
    triggerPwaInstall,
    dismissPwaInstallBanner
  };
}
