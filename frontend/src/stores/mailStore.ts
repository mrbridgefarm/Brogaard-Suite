import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { db } from '../db/database';
import { useSuiteStore } from './suiteStore';
import type {
  MailFolder,
  MailHeader,
  MailDetail,
  SenderAlias,
  SieveOverview,
  SieveRule,
  MailClipboardState,
  MailUndoAction,
  ComposeMode,
  ComposePrefill,
  LayoutMode,
  ReaderThemeMode
} from '../types/mail';
import {
  fetchFoldersApi,
  createFolderApi,
  renameFolderApi,
  deleteFolderApi,
  fetchFolderMessagesApi,
  fetchMessageDetailApi,
  updateFlagsApi,
  markAllFolderMessagesAsReadApi,
  transferMessagesApi,
  deleteMessagesApi,
  reportSpamStatusApi,
  sendMailApi,
  saveDraftApi,
  syncMailcowAliasesApi,
  upsertAliasApi,
  deleteAliasApi,
  fetchSieveOverviewApi,
  fetchSpecificSieveScriptApi,
  saveSieveApi
} from '../services/mailApi';

const UNDO_TTL_MS = 30000;
const LOCAL_ALIASES_PREFIX = 'imap_sync_mail_aliases_';
const LAYOUT_MODE_KEY = 'imap_sync_mail_layout_mode_v1';
const READER_THEME_KEY = 'imap_sync_mail_reader_theme_v1';
const AUTO_REFRESH_KEY = 'imap_sync_mail_auto_refresh_min_v1';

export type AutoRefreshMinutes = 0 | 1 | 2 | 5 | 10;

export const useMailStore = defineStore('mail', () => {
  const suiteStore = useSuiteStore();

  const isAuthenticated = computed(() => suiteStore.isAuthenticated);
  const username = computed(() => suiteStore.username);
  const isOnline = computed(() => suiteStore.isOnline);

  // Synkronisering & loading state
  const isSyncing = ref(false);
  const isLoadingMessage = ref(false);
  const isSendingMail = ref(false);
  const lastSyncedAt = ref<string | null>(null);

  const savedInterval = Number(localStorage.getItem(AUTO_REFRESH_KEY));
  const autoRefreshMinutes = ref<AutoRefreshMinutes>(
    savedInterval === 0 ||
      savedInterval === 1 ||
      savedInterval === 2 ||
      savedInterval === 5 ||
      savedInterval === 10
      ? (savedInterval as AutoRefreshMinutes)
      : 2
  );
  let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

  // Mapper & Beskeder
  const folders = ref<MailFolder[]>([]);
  const activeFolderPath = ref('INBOX');
  const messages = ref<MailHeader[]>([]);
  const totalFolderMessages = ref(0);
  const selectedMessageIds = ref<string[]>([]);
  const activeMessageId = ref<string | null>(null);
  const activeMessageDetail = ref<MailDetail | null>(null);

  // Filtrering & Søgning
  const searchQuery = ref('');
  const filterMode = ref<'ALL' | 'UNREAD' | 'FLAGGED' | 'ATTACHMENTS'>('ALL');
  const cachedAllHeaders = ref<MailHeader[]>([]);
  const isGlobalSearchActive = ref(false);
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  watch(searchQuery, (newQ) => {
    const q = newQ.trim();
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    if (!q) {
      if (isGlobalSearchActive.value) {
        isGlobalSearchActive.value = false;
        void loadFolderMessages(activeFolderPath.value, true);
      }
      return;
    }
    void db.mailHeaders
      .toArray()
      .then((all) => {
        cachedAllHeaders.value = all;
      })
      .catch(() => {});

    searchDebounceTimer = setTimeout(() => {
      void runServerSearch(true);
    }, 450);
  });

  // Afsender-aliaser
  const aliases = ref<SenderAlias[]>([]);
  const isAliasModalOpen = ref(false);
  const isSyncingAliases = ref(false);

  // Sieve-filterregler
  const isSieveModalOpen = ref(false);
  const isLoadingSieve = ref(false);
  const sieveOverview = ref<SieveOverview | null>(null);
  const sievePrefillRule = ref<SieveRule | null>(null);

  // Layout & Læser-tema
  const layoutMode = ref<LayoutMode>(
    (localStorage.getItem(LAYOUT_MODE_KEY) as LayoutMode) === 'ROUNDCUBE_SPLIT'
      ? 'ROUNDCUBE_SPLIT'
      : 'THREE_COL'
  );
  const readerThemeMode = ref<ReaderThemeMode>(
    (localStorage.getItem(READER_THEME_KEY) as ReaderThemeMode) === 'LIGHT_PAPER'
      ? 'LIGHT_PAPER'
      : 'SMART_DARK'
  );

  // Ny besked / Svar / Videresend
  const isComposeModalOpen = ref(false);
  const composeMode = ref<ComposeMode>('NEW');
  const composeSourceMessage = ref<MailDetail | null>(null);
  const composePrefill = ref<ComposePrefill | null>(null);

  // Udklipsholder
  const clipboard = ref<MailClipboardState>({
    mode: null,
    sourceFolder: '',
    messages: []
  });

  // Fortryd-stak
  const undoStack = ref<MailUndoAction[]>([]);

  // Kontekstmenu
  const contextMenu = ref<{
    visible: boolean;
    x: number;
    y: number;
    targetMessage: MailHeader | null;
    targetFolder: MailFolder | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    targetMessage: null,
    targetFolder: null
  });

  const activeFolder = computed<MailFolder | undefined>(() =>
    folders.value.find((f) => f.path === activeFolderPath.value)
  );

  const inboxUnreadCount = computed<number>(() => {
    const inbox =
      folders.value.find((f) => f.specialUse === 'inbox') ||
      folders.value.find((f) => f.path.toUpperCase() === 'INBOX');
    return inbox ? Number(inbox.unreadMessages || 0) : 0;
  });

  const defaultAlias = computed<SenderAlias | undefined>(() => {
    return (
      aliases.value.find((a) => a.isDefault) ||
      aliases.value[0] ||
      (username.value
        ? {
            id: `primary::${username.value}`,
            email: username.value,
            displayName: '',
            signature: '',
            isDefault: true,
            createdAt: ''
          }
        : undefined)
    );
  });

  const filteredMessages = computed<MailHeader[]>(() => {
    const q = searchQuery.value.trim().toLowerCase();
    let sourceList = messages.value;
    if (q && !isGlobalSearchActive.value && cachedAllHeaders.value.length > 0) {
      const byId = new Map<string, MailHeader>();
      for (const m of messages.value) byId.set(m.id, m);
      for (const m of cachedAllHeaders.value) {
        if (!byId.has(m.id)) byId.set(m.id, m);
      }
      sourceList = Array.from(byId.values()).sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
    }

    return sourceList.filter((m) => {
      if (filterMode.value === 'UNREAD' && m.seen) return false;
      if (filterMode.value === 'FLAGGED' && !m.flagged) return false;
      if (filterMode.value === 'ATTACHMENTS' && !m.hasAttachments) return false;

      if (!q) return true;
      const inSubject = m.subject.toLowerCase().includes(q);
      const inFrom = m.from.some(
        (f) => f.name.toLowerCase().includes(q) || f.address.toLowerCase().includes(q)
      );
      const inTo = m.to.some(
        (t) => t.name.toLowerCase().includes(q) || t.address.toLowerCase().includes(q)
      );
      const folderName = getFolderDisplayName(m.folder).toLowerCase();
      return inSubject || inFrom || inTo || folderName.includes(q);
    });
  });

  function getFolderDisplayName(folderPath: string): string {
    return folders.value.find((f) => f.path === folderPath)?.name || folderPath;
  }

  const searchResults = computed<MailHeader[]>(() => {
    if (!searchQuery.value.trim()) return [];
    return filteredMessages.value.slice(0, 12);
  });

  function notify(
    title: string,
    detail?: string,
    type: 'info' | 'success' | 'warning' | 'error' = 'info'
  ) {
    suiteStore.notify(title, detail, type);
  }

  function toPlainObject<T>(val: T): T {
    return JSON.parse(JSON.stringify(val)) as T;
  }

  function syncLocalAliasesCache(user: string, serverAliases: SenderAlias[]) {
    if (!user) return;
    const key = `${LOCAL_ALIASES_PREFIX}${user.toLowerCase().trim()}`;
    try {
      if (serverAliases.length > 0) {
        localStorage.setItem(key, JSON.stringify(serverAliases));
        aliases.value = serverAliases;
      } else {
        const cached = localStorage.getItem(key);
        if (cached) {
          aliases.value = JSON.parse(cached);
        }
      }
    } catch {
      aliases.value = serverAliases;
    }
  }

  function setupAutoRefreshTimer() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    if (autoRefreshMinutes.value > 0 && typeof window !== 'undefined') {
      const intervalMs = autoRefreshMinutes.value * 60 * 1000;
      autoRefreshTimer = setInterval(() => {
        if (
          isAuthenticated.value &&
          isOnline.value &&
          !isSyncing.value &&
          !searchQuery.value.trim()
        ) {
          void syncWithServer(true, true);
        }
      }, intervalMs);
    }
  }

  function setAutoRefreshMinutes(minutes: AutoRefreshMinutes) {
    autoRefreshMinutes.value = minutes;
    localStorage.setItem(AUTO_REFRESH_KEY, String(minutes));
    setupAutoRefreshTimer();
    if (minutes === 0) {
      notify('Auto-opdatering slået fra', 'E-mails opdateres nu kun ved manuelt klik.', 'info');
    } else {
      notify(
        'Auto-opdatering aktiv',
        `Tjekker automatisk for nye e-mails hvert ${minutes}. minut.`,
        'success'
      );
    }
  }

  async function hydrateSession(user: string, serverAliases: SenderAlias[]) {
    setupAutoRefreshTimer();
    syncLocalAliasesCache(user, serverAliases);

    try {
      const cachedFolders = await db.mailFolders.toArray();
      if (cachedFolders.length > 0) {
        folders.value = cachedFolders;
      }
    } catch {
      // Ignorér IndexedDB fejl
    }

    await syncWithServer(true);
  }

  async function hydrateAfterLogin(res: {
    username: string;
    folders: MailFolder[];
    aliases: SenderAlias[];
  }) {
    setupAutoRefreshTimer();
    folders.value = res.folders;
    syncLocalAliasesCache(res.username, res.aliases || []);

    try {
      await db.mailFolders.clear();
      if (res.folders.length > 0) {
        await db.mailFolders.bulkPut(toPlainObject(res.folders));
      }
    } catch {
      // Ignorér IndexedDB fejl
    }

    const inbox = res.folders.find((f) => f.specialUse === 'inbox') || res.folders[0];
    activeFolderPath.value = inbox ? inbox.path : 'INBOX';
    await loadFolderMessages(activeFolderPath.value, true);
  }

  function resetState() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    folders.value = [];
    messages.value = [];
    selectedMessageIds.value = [];
    activeMessageId.value = null;
    activeMessageDetail.value = null;
    aliases.value = [];
    searchQuery.value = '';
    clearClipboard();
    undoStack.value = [];
    closeContextMenu();
  }

  function logout() {
    void suiteStore.logout();
  }

  async function syncWithServer(silent = false, isAutoBackground = false) {
    if (!isAuthenticated.value) return;
    isSyncing.value = true;
    try {
      const prevIds = new Set(messages.value.map((m) => m.id));
      const updatedFolders = await fetchFoldersApi();
      folders.value = updatedFolders;
      try {
        await db.mailFolders.clear();
        await db.mailFolders.bulkPut(toPlainObject(updatedFolders));
      } catch {
        // Ignorér IndexedDB cache-fejl
      }

      await loadFolderMessages(activeFolderPath.value, true);
      lastSyncedAt.value = new Date().toLocaleTimeString('da-DK', {
        hour: '2-digit',
        minute: '2-digit'
      });

      if (isAutoBackground && prevIds.size > 0) {
        const newArrivals = messages.value.filter((m) => !prevIds.has(m.id) && !m.seen);
        if (newArrivals.length > 0) {
          notify(`Ny e-mail (${newArrivals.length})`, newArrivals[0].subject, 'info');
        }
      } else if (!silent) {
        notify('Synkroniseret', 'Mapper og e-mails er opdateret fra IMAP-serveren.', 'success');
      }
    } catch (err: any) {
      if (!silent) {
        notify('Synkroniseringsfejl', err?.message || 'Kunne ikke kontakte IMAP-serveren.', 'error');
      }
    } finally {
      isSyncing.value = false;
    }
  }

  async function selectFolder(folderPath: string) {
    if (searchQuery.value.trim()) {
      searchQuery.value = '';
      isGlobalSearchActive.value = false;
    } else if (activeFolderPath.value === folderPath && messages.value.length > 0) {
      return;
    }
    activeFolderPath.value = folderPath;
    selectedMessageIds.value = [];
    activeMessageId.value = null;
    activeMessageDetail.value = null;
    await loadFolderMessages(folderPath, false);
  }

  async function loadFolderMessages(folderPath: string, silent = false) {
    if (!isAuthenticated.value) return;
    isSyncing.value = true;

    try {
      const cached = await db.mailHeaders.where('folder').equals(folderPath).toArray();
      if (cached.length > 0) {
        cached.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        messages.value = cached;
      }
    } catch {
      // Ignorér
    }

    try {
      const res = await fetchFolderMessagesApi({
        folder: folderPath,
        limit: 120,
        page: 1
      });
      messages.value = res.messages;
      totalFolderMessages.value = res.total;

      try {
        await db.mailHeaders.where('folder').equals(folderPath).delete();
        if (res.messages.length > 0) {
          await db.mailHeaders.bulkPut(toPlainObject(res.messages));
        }
      } catch {
        // Ignorér
      }

      const folderObj = folders.value.find((f) => f.path === folderPath);
      if (folderObj) {
        folderObj.totalMessages = res.total;
        folderObj.unreadMessages = res.messages.filter((m) => !m.seen).length;
      }
    } catch (err: any) {
      if (!silent) {
        notify('Kunne ikke hente mappe', err?.message || 'Fejl ved læsning af IMAP-mappe.', 'error');
      }
    } finally {
      isSyncing.value = false;
    }
  }

  async function runServerSearch(silent = false) {
    const q = searchQuery.value.trim();
    if (!q) {
      isGlobalSearchActive.value = false;
      await loadFolderMessages(activeFolderPath.value, true);
      return;
    }
    isSyncing.value = true;
    try {
      const res = await fetchFolderMessagesApi({
        folder: activeFolderPath.value,
        searchQuery: q,
        searchAllFolders: true,
        limit: 150
      });
      if (searchQuery.value.trim() === q) {
        isGlobalSearchActive.value = true;
        messages.value = res.messages;
        if (!silent) {
          notify(
            'Søgning i alle mapper',
            `Fandt ${res.messages.length} e-mail(s) på tværs af alle mapper (inkl. Papirkurv).`,
            'info'
          );
        }
      }
    } catch (err: any) {
      if (!silent) {
        notify('Søgefejl', err?.message || 'Kunne ikke udføre søgning på serveren.', 'error');
      }
    } finally {
      isSyncing.value = false;
    }
  }

  async function openMessage(msg: MailHeader, addToSelection = false) {
    if (addToSelection) {
      if (selectedMessageIds.value.includes(msg.id)) {
        selectedMessageIds.value = selectedMessageIds.value.filter((id) => id !== msg.id);
      } else {
        selectedMessageIds.value = [...selectedMessageIds.value, msg.id];
      }
      return;
    }

    selectedMessageIds.value = [msg.id];
    activeMessageId.value = msg.id;

    try {
      const cachedDetail = await db.mailDetails.get(msg.id);
      if (cachedDetail) {
        activeMessageDetail.value = cachedDetail;
      }
    } catch {
      // Ignorér
    }

    isLoadingMessage.value = true;
    try {
      const detail = await fetchMessageDetailApi(msg.folder, msg.uid, true);
      activeMessageDetail.value = detail;

      const idx = messages.value.findIndex((m) => m.id === msg.id);
      if (idx >= 0 && !messages.value[idx].seen) {
        messages.value[idx].seen = true;
        const folderObj = folders.value.find((f) => f.path === msg.folder);
        if (folderObj && folderObj.unreadMessages > 0) {
          folderObj.unreadMessages -= 1;
        }
      }

      try {
        await db.mailDetails.put(toPlainObject(detail));
        if (idx >= 0) {
          await db.mailHeaders.put(toPlainObject(messages.value[idx]));
        }
      } catch {
        // Ignorér
      }
    } catch (err: any) {
      notify('Fejl ved åbning af mail', err?.message || 'Kunne ikke hente beskedens indhold.', 'error');
    } finally {
      isLoadingMessage.value = false;
    }
  }

  function selectMessageRange(targetMsg: MailHeader) {
    const list = filteredMessages.value;
    if (selectedMessageIds.value.length === 0) {
      selectedMessageIds.value = [targetMsg.id];
      return;
    }
    const lastId = selectedMessageIds.value[selectedMessageIds.value.length - 1];
    const startIdx = list.findIndex((m) => m.id === lastId);
    const endIdx = list.findIndex((m) => m.id === targetMsg.id);
    if (startIdx === -1 || endIdx === -1) {
      selectedMessageIds.value = [targetMsg.id];
      return;
    }
    const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    const rangeIds = list.slice(from, to + 1).map((m) => m.id);
    selectedMessageIds.value = Array.from(new Set([...selectedMessageIds.value, ...rangeIds]));
  }

  function selectAllInCurrentList() {
    selectedMessageIds.value = filteredMessages.value.map((m) => m.id);
  }

  function navigateSelection(delta: 1 | -1) {
    const list = filteredMessages.value;
    if (list.length === 0) return;

    const currentId = activeMessageId.value || selectedMessageIds.value[0];
    const currentIdx = list.findIndex((m) => m.id === currentId);
    const nextIdx =
      currentIdx === -1 ? 0 : Math.max(0, Math.min(list.length - 1, currentIdx + delta));
    const target = list[nextIdx];
    if (target) {
      void openMessage(target, false);
    }
  }

  function pushUndoAction(action: Omit<MailUndoAction, 'id' | 'createdAt'>) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const entry: MailUndoAction = {
      ...action,
      id,
      createdAt: Date.now()
    };
    undoStack.value.push(entry);
    setTimeout(() => {
      undoStack.value = undoStack.value.filter((u) => u.id !== id);
    }, UNDO_TTL_MS);
  }

  async function triggerUndo() {
    const latest = undoStack.value.pop();
    if (!latest) return;

    try {
      if (latest.type === 'FLAGS' && latest.previousSeen !== undefined) {
        await updateFlagsApi({
          folder: latest.sourceFolder,
          uids: latest.uids,
          seen: latest.previousSeen
        });
        await loadFolderMessages(activeFolderPath.value, true);
        notify('Fortrudt (Ctrl+Z)', latest.label, 'info');
      } else if (latest.type === 'TRANSFER' && latest.targetFolder) {
        await selectFolder(latest.targetFolder);
        notify(
          'Åbnede mål-mappen',
          `Beskederne ligger i "${latest.targetFolder}" og kan flyttes tilbage med Ctrl+X / Ctrl+V.`,
          'info'
        );
      }
    } catch (err: any) {
      notify('Kunne ikke fortryde', err?.message || 'Handling kunne ikke fortrydes.', 'error');
    }
  }

  async function toggleSeenForMessages(msgs: MailHeader[], forceSeen?: boolean) {
    if (msgs.length === 0) return;
    const folder = msgs[0].folder;
    const uids = msgs.map((m) => m.uid);
    const newSeen = forceSeen !== undefined ? forceSeen : !msgs[0].seen;

    try {
      await updateFlagsApi({ folder, uids, seen: newSeen });
      for (const m of msgs) {
        const found = messages.value.find((item) => item.id === m.id);
        if (found) found.seen = newSeen;
        if (activeMessageDetail.value?.id === m.id) {
          activeMessageDetail.value.seen = newSeen;
        }
      }
      pushUndoAction({
        label: `Markeret som ${newSeen ? 'læst' : 'ulæst'}`,
        type: 'FLAGS',
        sourceFolder: folder,
        uids,
        previousSeen: !newSeen
      });
      void fetchFoldersApi().then((f) => (folders.value = f));
    } catch (err: any) {
      notify('Fejl', err?.message || 'Kunne ikke ændre læst-status.', 'error');
    }
  }

  async function markFolderAllAsRead(folderPath: string) {
    isSyncing.value = true;
    try {
      const res = await markAllFolderMessagesAsReadApi(folderPath);
      const folderObj = folders.value.find((f) => f.path === folderPath);
      const folderName = folderObj?.name || folderPath;
      if (folderObj) {
        folderObj.unreadMessages = 0;
      }

      if (activeFolderPath.value === folderPath) {
        messages.value = messages.value.map((m) => ({ ...m, seen: true }));
        if (activeMessageDetail.value && activeMessageDetail.value.folder === folderPath) {
          activeMessageDetail.value.seen = true;
        }
      }

      notify(
        'Mappe markeret som læst',
        res.markedCount > 0
          ? `${res.markedCount} e-mail(s) i "${folderName}" blev markeret som læst.`
          : `Alle e-mails i "${folderName}" var allerede læst.`,
        'success'
      );
      void fetchFoldersApi().then((f) => (folders.value = f));
    } catch (err: any) {
      notify('Fejl', err?.message || 'Kunne ikke markere mappen som læst.', 'error');
    } finally {
      isSyncing.value = false;
    }
  }

  async function toggleFlaggedForMessages(msgs: MailHeader[]) {
    if (msgs.length === 0) return;
    const folder = msgs[0].folder;
    const uids = msgs.map((m) => m.uid);
    const newFlagged = !msgs[0].flagged;

    try {
      await updateFlagsApi({ folder, uids, flagged: newFlagged });
      for (const m of msgs) {
        const found = messages.value.find((item) => item.id === m.id);
        if (found) found.flagged = newFlagged;
        if (activeMessageDetail.value?.id === m.id) {
          activeMessageDetail.value.flagged = newFlagged;
        }
      }
    } catch (err: any) {
      notify('Fejl', err?.message || 'Kunne ikke ændre stjernemarkering.', 'error');
    }
  }

  function copyOrCutSelection(mode: 'COPY' | 'CUT', explicitMessages?: MailHeader[]) {
    const selected =
      explicitMessages || messages.value.filter((m) => selectedMessageIds.value.includes(m.id));

    if (selected.length === 0) {
      notify('Ingen e-mails valgt', 'Klik på én eller flere e-mails først.', 'warning');
      return;
    }

    clipboard.value = {
      mode,
      sourceFolder: selected[0].folder,
      messages: selected
    };

    notify(
      mode === 'CUT'
        ? `${selected.length} e-mail(s) klippet (Ctrl+X)`
        : `${selected.length} e-mail(s) kopieret (Ctrl+C)`,
      'Vælg en mål-mappe i sidepanelet og tryk Ctrl+V (eller klik Indsæt).',
      'info'
    );
  }

  function clearClipboard() {
    clipboard.value = {
      mode: null,
      sourceFolder: '',
      messages: []
    };
  }

  async function pasteClipboardToFolder(targetFolderPath?: string) {
    const target = targetFolderPath || activeFolderPath.value;
    const { mode, sourceFolder, messages: clipMsgs } = clipboard.value;

    if (!mode || clipMsgs.length === 0) return;
    if (sourceFolder === target && mode === 'CUT') {
      notify('Samme mappe', 'Beskederne ligger allerede i denne mappe.', 'warning');
      return;
    }

    const uids = clipMsgs.map((m) => m.uid);
    isSyncing.value = true;
    try {
      await transferMessagesApi({
        sourceFolder,
        targetFolder: target,
        uids,
        mode: mode === 'CUT' ? 'MOVE' : 'COPY'
      });

      const targetName = folders.value.find((f) => f.path === target)?.name || target;
      notify(
        mode === 'CUT' ? 'E-mails flyttet (Ctrl+V)' : 'E-mails kopieret (Ctrl+V)',
        `${uids.length} e-mail(s) blev ${mode === 'CUT' ? 'flyttet' : 'kopieret'} til "${targetName}".`,
        'success'
      );

      if (mode === 'CUT') {
        pushUndoAction({
          label: `Flyttede ${uids.length} e-mail(s) til ${targetName}`,
          type: 'TRANSFER',
          sourceFolder,
          targetFolder: target,
          uids
        });
        clearClipboard();
      }

      await syncWithServer(true);
    } catch (err: any) {
      notify('Fejl ved indsæt', err?.message || 'Kunne ikke overføre e-mails.', 'error');
    } finally {
      isSyncing.value = false;
    }
  }

  async function moveMessagesToFolder(msgs: MailHeader[], targetFolderPath: string) {
    if (msgs.length === 0) return;
    const sourceFolder = msgs[0].folder;
    if (sourceFolder === targetFolderPath) return;

    const uids = msgs.map((m) => m.uid);
    isSyncing.value = true;
    try {
      await transferMessagesApi({
        sourceFolder,
        targetFolder: targetFolderPath,
        uids,
        mode: 'MOVE'
      });

      const idSet = new Set(msgs.map((m) => m.id));
      messages.value = messages.value.filter((m) => !idSet.has(m.id));
      if (activeMessageId.value && idSet.has(activeMessageId.value)) {
        activeMessageId.value = null;
        activeMessageDetail.value = null;
      }
      selectedMessageIds.value = selectedMessageIds.value.filter((id) => !idSet.has(id));

      const targetName =
        folders.value.find((f) => f.path === targetFolderPath)?.name || targetFolderPath;
      pushUndoAction({
        label: `Flyttede ${uids.length} e-mail(s) til ${targetName}`,
        type: 'TRANSFER',
        sourceFolder,
        targetFolder: targetFolderPath,
        uids
      });

      notify('Flyttet', `${uids.length} e-mail(s) flyttet til "${targetName}".`, 'success');
      void fetchFoldersApi().then((f) => (folders.value = f));
    } catch (err: any) {
      notify('Fejl ved flytning', err?.message || 'Kunne ikke flytte e-mails.', 'error');
    } finally {
      isSyncing.value = false;
    }
  }

  async function deleteSelectedMessages(explicitMessages?: MailHeader[]) {
    const targets =
      explicitMessages || messages.value.filter((m) => selectedMessageIds.value.includes(m.id));

    if (targets.length === 0) return;
    const folder = targets[0].folder;
    const uids = targets.map((m) => m.uid);
    const isTrashFolder = activeFolder.value?.specialUse === 'trash';

    isSyncing.value = true;
    try {
      const res = await deleteMessagesApi({
        folder,
        uids,
        permanent: isTrashFolder
      });

      const idSet = new Set(targets.map((m) => m.id));
      messages.value = messages.value.filter((m) => !idSet.has(m.id));
      if (activeMessageId.value && idSet.has(activeMessageId.value)) {
        activeMessageId.value = null;
        activeMessageDetail.value = null;
      }
      selectedMessageIds.value = selectedMessageIds.value.filter((id) => !idSet.has(id));

      if (res.movedToTrash && res.trashFolder) {
        pushUndoAction({
          label: `Flyttede ${uids.length} e-mail(s) til Papirkurv`,
          type: 'TRANSFER',
          sourceFolder: folder,
          targetFolder: res.trashFolder,
          uids
        });
        notify('Flyttet til Papirkurv', `${uids.length} e-mail(s) blev lagt i papirkurven.`, 'info');
      } else {
        notify('Slettet permanent', `${uids.length} e-mail(s) blev slettet permanent.`, 'warning');
      }

      void fetchFoldersApi().then((f) => (folders.value = f));
    } catch (err: any) {
      notify('Sletning mislykkedes', err?.message || 'Kunne ikke slette e-mails.', 'error');
    } finally {
      isSyncing.value = false;
    }
  }

  async function markMessagesAsSpam(explicitMessages?: MailHeader[], forceSpam?: boolean) {
    const targets =
      explicitMessages || messages.value.filter((m) => selectedMessageIds.value.includes(m.id));

    if (targets.length === 0) return;
    const folder = targets[0].folder;
    const uids = targets.map((m) => m.uid);
    const isCurrentlyInJunk = activeFolder.value?.specialUse === 'junk';
    const isSpam = forceSpam !== undefined ? forceSpam : !isCurrentlyInJunk;

    isSyncing.value = true;
    try {
      const res = await reportSpamStatusApi({
        folder,
        uids,
        isSpam
      });

      const idSet = new Set(targets.map((m) => m.id));
      messages.value = messages.value.filter((m) => !idSet.has(m.id));
      if (activeMessageId.value && idSet.has(activeMessageId.value)) {
        activeMessageId.value = null;
        activeMessageDetail.value = null;
      }
      selectedMessageIds.value = selectedMessageIds.value.filter((id) => !idSet.has(id));

      pushUndoAction({
        label: isSpam
          ? `Markerede ${uids.length} e-mail(s) som Spam`
          : `Flyttede ${uids.length} e-mail(s) tilbage til Indbakke`,
        type: 'TRANSFER',
        sourceFolder: folder,
        targetFolder: res.targetFolder,
        uids
      });

      if (isSpam) {
        notify(
          'Markeret som Spam (Rspamd)',
          `${uids.length} e-mail(s) blev flyttet til Spam-mappen, så Rspamd lærer af det.`,
          'warning'
        );
      } else {
        notify(
          'Markeret som Ikke-spam (Rspamd)',
          `${uids.length} e-mail(s) blev flyttet tilbage til Indbakke.`,
          'success'
        );
      }

      void fetchFoldersApi().then((f) => (folders.value = f));
    } catch (err: any) {
      notify('Fejl ved spam-markering', err?.message || 'Kunne ikke flytte e-mails til Spam.', 'error');
    } finally {
      isSyncing.value = false;
    }
  }

  async function createFolder(path: string): Promise<boolean> {
    try {
      const updated = await createFolderApi(path);
      folders.value = updated;
      notify('Mappe oprettet', `Mappen "${path}" blev oprettet på serveren.`, 'success');
      return true;
    } catch (err: any) {
      notify('Fejl ved oprettelse', err?.message || 'Kunne ikke oprette mappen.', 'error');
      return false;
    }
  }

  async function renameFolder(oldPath: string, newPath: string): Promise<boolean> {
    try {
      const updated = await renameFolderApi(oldPath, newPath);
      folders.value = updated;
      if (activeFolderPath.value === oldPath) {
        activeFolderPath.value = newPath;
      }
      notify('Mappe omdøbt', `Omdøbt til "${newPath}".`, 'success');
      return true;
    } catch (err: any) {
      notify('Fejl ved omdøbning', err?.message || 'Kunne ikke omdøbe mappen.', 'error');
      return false;
    }
  }

  async function deleteFolder(path: string): Promise<boolean> {
    try {
      const updated = await deleteFolderApi(path);
      folders.value = updated;
      if (activeFolderPath.value === path) {
        activeFolderPath.value = 'INBOX';
        await loadFolderMessages('INBOX', true);
      }
      notify('Mappe slettet', `Mappen "${path}" blev slettet.`, 'warning');
      return true;
    } catch (err: any) {
      notify('Fejl ved sletning', err?.message || 'Kunne ikke slette mappen.', 'error');
      return false;
    }
  }

  async function saveAlias(params: {
    id?: string;
    email: string;
    displayName?: string;
    signature?: string;
    isDefault?: boolean;
  }): Promise<boolean> {
    try {
      const updated = await upsertAliasApi(params);
      syncLocalAliasesCache(username.value, updated);
      notify('Afsender-alias gemt', `${params.email} er nu gemt i dine afsenderadresser.`, 'success');
      return true;
    } catch (err: any) {
      notify('Kunne ikke gemme alias', err?.message || 'Kontrollér e-mailadressen.', 'error');
      return false;
    }
  }

  async function removeAlias(id: string): Promise<boolean> {
    try {
      const updated = await deleteAliasApi(id);
      syncLocalAliasesCache(username.value, updated);
      notify('Alias fjernet', 'Afsender-aliaset er slettet.', 'info');
      return true;
    } catch (err: any) {
      notify('Kunne ikke fjerne alias', err?.message || 'Fejl ved sletning af alias.', 'error');
      return false;
    }
  }

  async function syncAliasesFromMailcow(): Promise<boolean> {
    if (isSyncingAliases.value) return false;
    isSyncingAliases.value = true;
    try {
      const res = await syncMailcowAliasesApi();
      syncLocalAliasesCache(username.value, res.aliases);
      const viaLabel =
        res.sources.sogoDav && res.sources.mailcowApi
          ? 'SOGo DAV + Mailcow API'
          : res.sources.mailcowApi
            ? 'Mailcow API'
            : res.sources.sogoDav
              ? 'Mailcow / SOGo DAV'
              : 'serveren';
      notify(
        'Aliaser synkroniseret',
        `Fandt ${res.discoveredCount} adresse(r) fra ${viaLabel}. Du har i alt ${res.aliases.length} afsender-alias(er).`,
        'success'
      );
      return true;
    } catch (err: any) {
      notify(
        'Alias-synkronisering fejlede',
        err?.message || 'Kunne ikke hente aliaser fra Mailcow.',
        'error'
      );
      return false;
    } finally {
      isSyncingAliases.value = false;
    }
  }

  function openComposeModal(
    mode: ComposeMode = 'NEW',
    sourceMsg?: MailDetail | null,
    prefill?: ComposePrefill | null
  ) {
    composeMode.value = mode;
    composeSourceMessage.value = mode === 'NEW' ? null : (sourceMsg || activeMessageDetail.value || null);
    composePrefill.value = prefill || null;
    isComposeModalOpen.value = true;
  }

  async function sendMail(params: {
    fromEmail: string;
    fromName?: string;
    saveAlias?: boolean;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    textBody: string;
    htmlBody?: string;
    inReplyTo?: string;
    references?: string[];
    replyFolder?: string;
    replyUid?: number;
    attachments?: Array<{
      filename: string;
      contentType: string;
      contentBase64: string;
    }>;
  }): Promise<boolean> {
    isSendingMail.value = true;
    try {
      const res = await sendMailApi(params);
      if (res.aliases) {
        syncLocalAliasesCache(username.value, res.aliases);
      }
      isComposeModalOpen.value = false;
      notify('E-mail sendt', `Sendt fra ${params.fromEmail} til ${params.to.join(', ')}`, 'success');
      void syncWithServer(true);
      return true;
    } catch (err: any) {
      notify('Kunne ikke sende e-mail', err?.message || 'SMTP-afsendelse fejlede.', 'error');
      return false;
    } finally {
      isSendingMail.value = false;
    }
  }

  async function saveDraft(params: {
    fromEmail: string;
    fromName?: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    textBody: string;
    htmlBody?: string;
    attachments?: Array<{
      filename: string;
      contentType: string;
      contentBase64: string;
    }>;
  }): Promise<boolean> {
    isSendingMail.value = true;
    try {
      await saveDraftApi(params);
      isComposeModalOpen.value = false;
      notify('Kladde gemt', 'E-mailen blev gemt i mappen Kladder på IMAP-serveren.', 'info');
      void syncWithServer(true);
      return true;
    } catch (err: any) {
      notify('Kunne ikke gemme kladde', err?.message || 'Fejl ved gem af kladde.', 'error');
      return false;
    } finally {
      isSendingMail.value = false;
    }
  }

  function openMessageContextMenu(e: MouseEvent, msg: MailHeader) {
    if (!selectedMessageIds.value.includes(msg.id)) {
      selectedMessageIds.value = [msg.id];
    }
    contextMenu.value = {
      visible: true,
      x: Math.min(window.innerWidth - 250, e.clientX),
      y: Math.min(window.innerHeight - 340, e.clientY),
      targetMessage: msg,
      targetFolder: null
    };
  }

  function openFolderContextMenu(e: MouseEvent, folder: MailFolder) {
    contextMenu.value = {
      visible: true,
      x: Math.min(window.innerWidth - 250, e.clientX),
      y: Math.min(window.innerHeight - 220, e.clientY),
      targetMessage: null,
      targetFolder: folder
    };
  }

  function closeContextMenu() {
    contextMenu.value.visible = false;
  }

  function setLayoutMode(mode: LayoutMode) {
    layoutMode.value = mode;
    localStorage.setItem(LAYOUT_MODE_KEY, mode);
  }

  function setReaderThemeMode(mode: ReaderThemeMode) {
    readerThemeMode.value = mode;
    localStorage.setItem(READER_THEME_KEY, mode);
  }

  async function openSieveModal(prefillFromMessage?: MailHeader | MailDetail | null) {
    if (prefillFromMessage) {
      const senderAddr = prefillFromMessage.from[0]?.address || '';
      sievePrefillRule.value = {
        id: `new-${Date.now()}`,
        name: senderAddr
          ? `Filter for ${prefillFromMessage.from[0]?.name || senderAddr}`
          : `Filter: ${prefillFromMessage.subject.slice(0, 30)}`,
        enabled: true,
        matchType: 'anyof',
        conditions: [
          {
            field: senderAddr ? 'from' : 'subject',
            comparator: 'contains',
            value: senderAddr || prefillFromMessage.subject
          }
        ],
        actions: [
          {
            type: 'fileinto',
            target:
              activeFolderPath.value !== 'INBOX'
                ? activeFolderPath.value
                : folders.value.find((f) => f.specialUse === 'archive')?.path || 'INBOX'
          }
        ],
        stopProcessing: true
      };
    } else {
      sievePrefillRule.value = null;
    }

    isSieveModalOpen.value = true;
    await loadSieveOverview();
  }

  async function loadSieveOverview() {
    isLoadingSieve.value = true;
    try {
      const ov = await fetchSieveOverviewApi();
      sieveOverview.value = ov;
    } catch (err: any) {
      notify(
        'ManageSieve (Port 4190)',
        err?.message || 'Kunne ikke hente Sieve-regler fra serveren.',
        'warning'
      );
    } finally {
      isLoadingSieve.value = false;
    }
  }

  async function selectSieveScript(scriptName: string) {
    isLoadingSieve.value = true;
    try {
      const res = await fetchSpecificSieveScriptApi(scriptName);
      if (sieveOverview.value) {
        sieveOverview.value.activeScriptName = res.scriptName;
        sieveOverview.value.rawScript = res.rawScript;
        sieveOverview.value.rules = res.rules;
      }
    } catch (err: any) {
      notify('Sieve fejl', err?.message || 'Kunne ikke indlæse det valgte Sieve-script.', 'error');
    } finally {
      isLoadingSieve.value = false;
    }
  }

  async function saveSieveConfig(params: {
    scriptName?: string;
    rules?: SieveRule[];
    rawScript?: string;
  }): Promise<boolean> {
    isLoadingSieve.value = true;
    try {
      const ov = await saveSieveApi(params);
      sieveOverview.value = ov;
      notify(
        'Sieve-filterregler gemt',
        `Reglerne er nu aktive på serveren (${ov.activeScriptName}).`,
        'success'
      );
      return true;
    } catch (err: any) {
      notify('Kunne ikke gemme Sieve-regler', err?.message || 'Syntaks- eller forbindelsesfejl.', 'error');
      return false;
    } finally {
      isLoadingSieve.value = false;
    }
  }

  return {
    isAuthenticated,
    username,
    isOnline,
    isSyncing,
    isLoadingMessage,
    isSendingMail,
    lastSyncedAt,
    autoRefreshMinutes,
    setAutoRefreshMinutes,
    folders,
    activeFolderPath,
    activeFolder,
    inboxUnreadCount,
    messages,
    totalFolderMessages,
    selectedMessageIds,
    activeMessageId,
    activeMessageDetail,
    searchQuery,
    isGlobalSearchActive,
    getFolderDisplayName,
    filterMode,
    filteredMessages,
    searchResults,
    aliases,
    defaultAlias,
    isAliasModalOpen,
    isSyncingAliases,
    isSieveModalOpen,
    isLoadingSieve,
    sieveOverview,
    sievePrefillRule,
    layoutMode,
    readerThemeMode,
    isComposeModalOpen,
    composeMode,
    composeSourceMessage,
    composePrefill,
    clipboard,
    undoStack,
    contextMenu,
    notify,
    logout,
    hydrateSession,
    hydrateAfterLogin,
    resetState,
    syncWithServer,
    selectFolder,
    loadFolderMessages,
    runServerSearch,
    openMessage,
    selectMessageRange,
    selectAllInCurrentList,
    navigateSelection,
    triggerUndo,
    toggleSeenForMessages,
    markFolderAllAsRead,
    toggleFlaggedForMessages,
    copyOrCutSelection,
    clearClipboard,
    pasteClipboardToFolder,
    moveMessagesToFolder,
    deleteSelectedMessages,
    markMessagesAsSpam,
    createFolder,
    renameFolder,
    deleteFolder,
    saveAlias,
    removeAlias,
    syncAliasesFromMailcow,
    openComposeModal,
    sendMail,
    saveDraft,
    openMessageContextMenu,
    openFolderContextMenu,
    closeContextMenu,
    setLayoutMode,
    setReaderThemeMode,
    openSieveModal,
    loadSieveOverview,
    selectSieveScript,
    saveSieveConfig
  };
});
