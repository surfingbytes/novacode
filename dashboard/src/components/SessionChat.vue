<script setup lang="ts">
// node_modules
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronDown } from 'lucide-vue-next';

// components
import FilesView from '@/components/workspace/FilesComponent.vue';
import GitView from '@/components/workspace/GitView.vue';
import AppTerminal from '@/components/AppTerminal.vue';
import ConfirmModal from '@/components/ConfirmModal.vue';
import SessionEditModal from '@/components/SessionEditModal.vue';
import ClaudeLimitPopup from '@/components/ClaudeLimitPopup.vue';
import ChatMessageList from '@/components/chat/ChatMessageList.vue';
import ChatComposer, { type PendingAttachment } from '@/components/chat/ChatComposer.vue';
import ChatTodoPanel from '@/components/chat/ChatTodoPanel.vue';
import EntityDetailHeader from '@/components/ui/EntityDetailHeader.vue';
import BottomTabBar from '@/components/ui/BottomTabBar.vue';

// classes
import { sessionsApi, settingsApi, buildSessionTerminalWsUrl } from '@/classes/api';
import { renderMermaidDiagrams } from '@/lib/mermaid';
import { readSessionCache, writeSessionCache } from '@/lib/sessionCache';
import {
  getToolIconSvg,
  isPlanEntryCompleted,
  parseHistoryEventsCached,
  planStatusIcon,
  prepareDisplayItem,
  renderMdCached
} from '@/utils/chatDisplayItems';

// composables
import { useAgentOptions } from '@/composables/useAgentOptions';
import { useChatSocket } from '@/composables/useChatSocket';
import { usePlanDocuments } from '@/composables/usePlanDocuments';
import { useTodoList } from '@/composables/useTodoList';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';
import { useToastStore } from '@/stores/toasts';
import { useAuthStore } from '@/stores/auth';

// types
import type { ChatMessage, LinkedPlanContext, Session } from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------
const props = defineProps<{
  workspaceId: string;
  sessionId: string;
  viewportHeight: number | null;
  showSidebarToggle?: boolean;
}>();

// -------------------------------------------------- Emits --------------------------------------------------
const emit = defineEmits<{
  (e: 'toggle-sidebar'): void;
  (
    e: 'start-plan-session',
    payload: {
      defaultName: string;
      draftPrompt: string;
      linkedPlanContext?: LinkedPlanContext;
      defaultAgentType?: Session['agentType'];
      defaultModelSelection?: string;
      defaultSessionMode?: string;
    }
  ): void;
}>();

// -------------------------------------------------- Store --------------------------------------------------
const router = useRouter();
const workspacesStore = useWorkspacesStore();
const toastStore = useToastStore();
const auth = useAuthStore();

// -------------------------------------------------- Refs --------------------------------------------------
// Last-known snapshot for this session (chat + plan) — shown instantly while
// REST/WebSocket revalidate, so a cold start on a poor connection doesn't
// stare at a skeleton for data the app already had.
const initialCache = readSessionCache(props.workspaceId, props.sessionId);
const session = ref<Session | null>(initialCache?.session ?? null);
const bLoading = ref(!initialCache);
const error = ref<string | null>(null);
const bShowEditModal = ref(false);
const bSavingEdit = ref(false);
const bShowDeleteModal = ref(false);
const bDeletingSession = ref(false);
const bPlanActionsMenuOpen = ref(false);
const planActionsMenuRef = ref<HTMLElement | null>(null);
const sessionChatRootRef = ref<HTMLElement | null>(null);
const chatListRef = ref<InstanceType<typeof ChatMessageList> | null>(null);
const composerRef = ref<InstanceType<typeof ChatComposer> | null>(null);
const lightboxSrc = ref<string | null>(null);

// Claude limit popup state
const bShowClaudeLimitPopup = ref(false);
const claudeLimitResetTime = ref('');
const claudeLimitResetTimeReadable = ref('');
const bClaudeAutoContinueEnabled = ref(false);

const HIDE_THINKING_LS_KEY = 'nova:chat:hideThinkingOutput';
const hideThinkingOutput = ref(readHideThinkingFromLs());

function readHideThinkingFromLs(): boolean {
  try {
    return localStorage.getItem(HIDE_THINKING_LS_KEY) === '1';
  } catch {
    return false;
  }
}

function onHideThinkingToggle(checked: boolean): void {
  hideThinkingOutput.value = checked;
  if (checked) chatSocket.streamingThinkingText.value = '';
  try {
    if (checked) localStorage.setItem(HIDE_THINKING_LS_KEY, '1');
    else localStorage.removeItem(HIDE_THINKING_LS_KEY);
  } catch {
    // ignore quota / private mode
  }
}

const expandedToolOutputIds = ref(new Set<string>());

function toggleToolOutput(callId: string): void {
  const next = new Set(expandedToolOutputIds.value);
  if (next.has(callId)) next.delete(callId);
  else next.add(callId);
  expandedToolOutputIds.value = next;
}

type SessionTab = 'chat' | 'terminal' | 'files' | 'git' | 'plan';
const activeTab = ref<SessionTab>('chat');

let mermaidRenderTimer: ReturnType<typeof setTimeout> | null = null;
let fetchSessionSeq = 0;

function scheduleMermaidRender(): void {
  if (mermaidRenderTimer !== null) {
    clearTimeout(mermaidRenderTimer);
  }
  mermaidRenderTimer = setTimeout(() => {
    mermaidRenderTimer = null;
    void nextTick(() => {
      void renderMermaidDiagrams(sessionChatRootRef.value);
    });
  }, 80);
}

// -------------------------------------------------- Agent options (model/mode/config) --------------------------------------------------
const agentOptions = useAgentOptions({
  workspaceId: () => props.workspaceId,
  sessionId: () => props.sessionId,
  session
});
const {
  modelSelection,
  modelOptions,
  modeOptions,
  agentConfigOptions,
  thinkingOptions,
  sessionConfig,
  bModelsLoading,
  bModesLoading,
  bConfigLoading,
  bSavingModelSelection,
  bSavingSessionMode,
  bSavingSessionConfig,
  displaySessionMode,
  selectedModeOption,
  selectedModeIconName,
  bSelectedModelMissing,
  applyInboundModeUpdate,
  applyInboundModelUpdate,
  applyInboundConfigUpdate,
  onAgentConfigChange,
  agentConfigDisplayValue,
  onSharedModelPickerUpdate,
  onSharedThinkingPickerUpdate,
  onSessionModeChange,
  loadAgentOptions
} = agentOptions;

// -------------------------------------------------- Chat socket --------------------------------------------------
const chatSocket = useChatSocket({
  sessionId: () => props.sessionId,
  workspaceId: () => props.workspaceId,
  initialMessages: initialCache?.messages,
  initialHasMore: initialCache?.bHasMore,
  shouldBeConnected: () => activeTab.value === 'chat',
  isThinkingHidden: () => hideThinkingOutput.value,
  onModeUpdate: applyInboundModeUpdate,
  onModelUpdate: applyInboundModelUpdate,
  onConfigUpdate: applyInboundConfigUpdate,
  onNewPlanItem: (planId) => {
    planDocs.selectedPlanId.value = planId;
    activeTab.value = 'plan';
  },
  onHistoryLoaded: () => {
    void nextTick(() => chatListRef.value?.forceInitialScrollToBottom());
  },
  onHistoryPage: () => {
    void chatListRef.value?.notifyHistoryPage();
  },
  onContentAppended: () => {
    // ChatMessageList follows pinned-bottom internally.
  },
  onDone: () => {
    planDocs.schedulePlanDocumentsRefresh(250, { selectLatest: activeTab.value === 'plan' });
    planDocs.schedulePlanDocumentsRefresh(1500, { selectLatest: activeTab.value === 'plan' });
  },
  onMessagesChanged: () => {
    scheduleSessionCachePersist();
  },
  sessionName: () => session.value?.name ?? 'Session',
  workspaceName: () => workspaceName.value,
  onClaudeLimitDetected: (resetTime, resetTimeReadable) => {
    bShowClaudeLimitPopup.value = true;
    claudeLimitResetTime.value = resetTime;
    claudeLimitResetTimeReadable.value = resetTimeReadable;
  }
});
const {
  messages,
  bIsStreaming,
  chatError,
  chatErrorCode,
  streamingItems,
  streamingThinkingText,
  streamingUsage,
  queuedPrompts,
  bHasMore,
  bLoadingMore,
  bHistoryLoaded,
  bWsConnected,
  bWsReconnecting
} = chatSocket;

// -------------------------------------------------- Session snapshot cache --------------------------------------------------
let persistCacheTimer: ReturnType<typeof setTimeout> | null = null;

function persistSessionCache(): void {
  writeSessionCache(props.workspaceId, props.sessionId, {
    session: session.value,
    messages: messages.value,
    bHasMore: bHasMore.value
  });
}

function scheduleSessionCachePersist(): void {
  if (persistCacheTimer !== null) {
    clearTimeout(persistCacheTimer);
  }
  persistCacheTimer = setTimeout(() => {
    persistCacheTimer = null;
    persistSessionCache();
  }, 400);
}

watch(session, () => {
  scheduleSessionCachePersist();
});

// -------------------------------------------------- Display items --------------------------------------------------
interface DisplayChatMessage {
  msg: ChatMessage;
  key: string;
  items: ReturnType<typeof prepareDisplayItem>[];
  fallbackHtml: string;
}

const displayMessages = computed<DisplayChatMessage[]>(() =>
  messages.value.map((msg, index) => {
    const items =
      msg.role === 'assistant'
        ? parseHistoryEventsCached(msg.events ?? []).map(prepareDisplayItem)
        : [];
    let planIndex = 0;
    for (const item of items) {
      if (item.kind !== 'plan') continue;
      item.planId = `${msg.createdAt}-${index}-plan-${planIndex}`;
      planIndex += 1;
    }
    return {
      msg,
      key: `${msg.createdAt}-${index}`,
      items,
      fallbackHtml: items.length === 0 && msg.content ? renderMdCached(msg.content) : ''
    };
  })
);

const streamingDisplayItems = computed(() => {
  const items = streamingItems.value.map(prepareDisplayItem);
  let planIndex = 0;
  for (const item of items) {
    if (item.kind !== 'plan') continue;
    item.planId = `live-plan-${planIndex}`;
    planIndex += 1;
  }
  return items;
});

// -------------------------------------------------- Plan documents --------------------------------------------------
const planDocs = usePlanDocuments({
  workspaceId: () => props.workspaceId,
  sessionId: () => props.sessionId,
  session,
  displayMessages,
  streamingDisplayItems,
  activeTab,
  modelSelection,
  onStartPlanSession: (payload) => {
    closePlanActionsMenu();
    emit('start-plan-session', payload);
  }
});
const { selectedPlanId, planDocuments, selectedPlanDocument, bShowPlanTab } = planDocs;

// -------------------------------------------------- Todo list panel --------------------------------------------------
const todoChecklistSvg = getToolIconSvg('checklist');
const todoList = useTodoList({ displayMessages, streamingDisplayItems });
const {
  todoItems,
  todoDoneCount,
  bAnyTodos,
  bTodosRunning,
  panelState: todoPanelState,
  bPanelClosed: bTodoPanelClosed,
  togglePanelState: toggleTodoPanelState,
  closePanel: closeTodoPanel,
  openPanel: openTodoPanel
} = todoList;

// -------------------------------------------------- Composer state --------------------------------------------------
const promptText = ref<string>('');
const pendingImages = ref<PendingAttachment[]>([]);
const bUploadingImage = ref(false);
const bChatInputMdUp = ref(false);
let chatInputMql: MediaQueryList | null = null;

const promptStorageKey = computed(() => `sessionPrompt:${props.workspaceId}:${props.sessionId}`);

function syncChatInputBreakpoint(): void {
  bChatInputMdUp.value = chatInputMql?.matches ?? window.matchMedia('(min-width: 768px)').matches;
}

function uploadAttachmentFile(file: File): void {
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const dataUrl = ev.target?.result as string;
    const base64 = dataUrl.split(',')[1];
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
    bUploadingImage.value = true;
    try {
      const mimeType = file.type || 'application/octet-stream';
      const { data } = await sessionsApi.uploadImage(props.sessionId, base64, mimeType, file.name);
      pendingImages.value.push({
        filename: data.filename,
        displayName: file.name,
        dataUrl: isImage ? dataUrl : '',
        serverPath: data.path,
        isImage
      });
    } catch {
      chatSocket.setChatError('Failed to upload file');
    } finally {
      bUploadingImage.value = false;
    }
  };
  reader.readAsDataURL(file);
}

function onUploadFiles(files: File[]): void {
  for (const file of files) {
    uploadAttachmentFile(file);
  }
}

function onComposerSend(payload: { text: string; imagePaths: string[] }): void {
  chatSocket.sendPrompt({
    text: payload.text,
    model: modelSelection.value,
    mode: displaySessionMode.value,
    imagePaths: payload.imagePaths
  });
}

// -------------------------------------------------- Computed --------------------------------------------------
const workspaceName = computed(
  () => workspacesStore.workspaces.find((w) => w.id === props.workspaceId)?.name ?? 'Workspace'
);
const sessionTerminalWsUrl = computed(() =>
  buildSessionTerminalWsUrl(props.workspaceId, props.sessionId)
);

const sessionTabs = computed(() => [
  { id: 'chat', label: 'Chat' },
  { id: 'plan', label: 'Plan', bVisible: bShowPlanTab.value },
  { id: 'terminal', label: 'Terminal' },
  { id: 'files', label: 'Files' },
  { id: 'git', label: 'Git' }
]);

const chatErrorActionLabel = computed(() => {
  if (chatErrorCode.value === 'auth_required') return 'Open Settings';
  if (chatErrorCode.value === 'timeout' && chatSocket.lastPromptRequest.value) return 'Try again';
  return '';
});

/** Tags used in this workspace (for edit session autocomplete). */
const sessionTagSuggestions = computed(() => {
  const wid = props.workspaceId;
  const all = workspacesStore.allSessions.filter((s) => s.workspaceId === wid);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of all) {
    const tags = s.tags;
    if (!tags?.length) continue;
    for (const t of tags) {
      if (typeof t !== 'string' || !t.trim()) continue;
      const k = t.trim().toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t.trim());
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
});

// -------------------------------------------------- Methods --------------------------------------------------
function handleChatErrorAction(): void {
  if (chatErrorCode.value === 'auth_required') {
    router.push({ name: 'settings' });
    return;
  }
  if (chatErrorCode.value === 'timeout') {
    chatSocket.retryLastPrompt(modelSelection.value);
  }
}

function closePlanActionsMenu(): void {
  bPlanActionsMenuOpen.value = false;
}

function handleDocumentClickMobileMenu(e: MouseEvent): void {
  const target = e.target as Node;
  const planActionsEl = planActionsMenuRef.value;
  if (bPlanActionsMenuOpen.value && planActionsEl && !planActionsEl.contains(target)) {
    closePlanActionsMenu();
  }
}

function handleKeydownMobileMenu(e: KeyboardEvent): void {
  if (e.key === 'Escape' && lightboxSrc.value) lightboxSrc.value = null;
  if (e.key === 'Escape' && bPlanActionsMenuOpen.value) closePlanActionsMenu();
}

// ── Session edit/delete/archive ──────────────────────────────────────────────
function openEditModal(): void {
  bShowEditModal.value = true;
}

async function saveSessionEdit(payload: { name: string; tags?: string[] | null }): Promise<void> {
  bSavingEdit.value = true;
  try {
    const { data: updated } = await sessionsApi.update(props.workspaceId, props.sessionId, payload);
    session.value = updated;
    bShowEditModal.value = false;
  } catch {
    toastStore.error('Failed to update session');
  } finally {
    bSavingEdit.value = false;
  }
}

async function deleteSession(): Promise<void> {
  bDeletingSession.value = true;
  try {
    await sessionsApi.remove(props.workspaceId, props.sessionId);
    router.push({ name: 'workspace-sessions', params: { id: props.workspaceId } });
  } catch {
    toastStore.error('Failed to delete session');
    bDeletingSession.value = false;
    bShowDeleteModal.value = false;
  }
}

async function toggleArchive(): Promise<void> {
  if (!session.value) return;
  try {
    const { data: updated } = await sessionsApi.update(props.workspaceId, props.sessionId, {
      archived: !session.value.archived
    });
    session.value = updated;
  } catch {
    toastStore.error('Failed to toggle archive');
  }
}

// ── Session fetch ─────────────────────────────────────────────────────────────
async function fetchSession(): Promise<boolean> {
  const seq = ++fetchSessionSeq;
  const workspaceId = props.workspaceId;
  const sessionId = props.sessionId;
  try {
    // Keep any cached snapshot on screen while revalidating — the skeleton is
    // only for when there is genuinely nothing to show.
    if (!session.value) {
      bLoading.value = true;
    }
    error.value = null;
    const response = await sessionsApi.get(workspaceId, sessionId);
    if (
      seq !== fetchSessionSeq ||
      workspaceId !== props.workspaceId ||
      sessionId !== props.sessionId
    ) {
      return false;
    }
    session.value = response.data;
    agentOptions.applyFetchedSession(response.data);
    void loadAgentOptions();
    return true;
  } catch (e) {
    if (
      seq !== fetchSessionSeq ||
      workspaceId !== props.workspaceId ||
      sessionId !== props.sessionId
    ) {
      return false;
    }
    if (!session.value) {
      error.value = 'Failed to load session';
    }
    console.error('Failed to fetch session:', e);
    return false;
  } finally {
    if (
      seq === fetchSessionSeq &&
      workspaceId === props.workspaceId &&
      sessionId === props.sessionId
    ) {
      bLoading.value = false;
    }
  }
}

function handleAutoContinueUpdated(enabled: boolean): void {
  console.log('Auto-continue preference updated:', enabled);
}

// -------------------------------------------------- Watchers --------------------------------------------------
watch(activeTab, (tab) => {
  if (tab === 'chat') {
    chatSocket.ensureConnected();
    nextTick(() => {
      composerRef.value?.resizeTextarea();
      composerRef.value?.observePromptInputBox();
    });
    scheduleMermaidRender();
  } else if (tab === 'plan') {
    planDocs.schedulePlanDocumentsRefresh(0, { selectLatest: true });
    scheduleMermaidRender();
  }
});

watch(promptText, (val) => {
  const key = promptStorageKey.value;
  if (!val) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, val);
  }
});

watch(
  () => [
    displayMessages.value.length,
    streamingDisplayItems.value.length,
    selectedPlanDocument.value?.renderedHtml ?? '',
    selectedPlanDocument.value?.id ?? ''
  ],
  () => {
    scheduleMermaidRender();
  }
);

watch(
  () => props.sessionId,
  async (newId, oldId) => {
    if (!newId || newId === oldId) return;
    if (persistCacheTimer !== null) {
      clearTimeout(persistCacheTimer);
      persistCacheTimer = null;
    }
    planDocs.resetPlanDocuments();
    chatSocket.resetChatState();
    chatSocket.disconnect();
    expandedToolOutputIds.value = new Set();
    activeTab.value = 'chat';
    const cached = readSessionCache(props.workspaceId, newId);
    session.value = cached?.session ?? null;
    if (cached) {
      chatSocket.hydrateHistory(cached.messages, cached.bHasMore);
    }
    bLoading.value = !cached;
    pendingImages.value = [];
    agentOptions.resetAgentOptions();

    const savedPrompt = localStorage.getItem(promptStorageKey.value);
    promptText.value = savedPrompt ?? '';

    const loaded = await fetchSession();
    // With a cached snapshot on screen, a failed refresh is fine — the socket
    // still reconnects and the fresh history frame replaces it.
    if (!loaded && !session.value) return;
    if (activeTab.value === 'chat') {
      chatSocket.connect();
      await nextTick();
      composerRef.value?.resizeTextarea();
      composerRef.value?.observePromptInputBox();
    }
  }
);

// -------------------------------------------------- Lifecycle --------------------------------------------------
onMounted(async () => {
  chatInputMql = window.matchMedia('(min-width: 768px)');
  syncChatInputBreakpoint();
  chatInputMql.addEventListener('change', syncChatInputBreakpoint);

  const savedPrompt = localStorage.getItem(promptStorageKey.value);
  if (savedPrompt != null) promptText.value = savedPrompt;

  await fetchSession();
  chatSocket.connect();
  try {
    const { data } = await settingsApi.get();
    if (typeof data.claudeAutoContinue === 'boolean') {
      bClaudeAutoContinueEnabled.value = data.claudeAutoContinue;
    }
  } catch {
    // keep defaults
  }
  document.addEventListener('click', handleDocumentClickMobileMenu);
  document.addEventListener('keydown', handleKeydownMobileMenu);
  scheduleMermaidRender();
});

onUnmounted(() => {
  if (mermaidRenderTimer !== null) {
    clearTimeout(mermaidRenderTimer);
    mermaidRenderTimer = null;
  }
  if (persistCacheTimer !== null) {
    clearTimeout(persistCacheTimer);
    persistCacheTimer = null;
  }
  persistSessionCache();
  if (chatInputMql) {
    chatInputMql.removeEventListener('change', syncChatInputBreakpoint);
    chatInputMql = null;
  }
  planDocs.clearPlanDocumentsRefreshTimers();
  chatSocket.disconnect();
  document.removeEventListener('click', handleDocumentClickMobileMenu);
  document.removeEventListener('keydown', handleKeydownMobileMenu);
});
</script>

<template>
  <div ref="sessionChatRootRef" class="flex-1 flex flex-col overflow-hidden">
    <!-- Header -->
    <EntityDetailHeader
      :title="session?.name || 'Session'"
      :subtitle="workspaceName"
      :tags="session?.tags ?? []"
      :b-loading="bLoading"
      :archived="session?.archived ?? false"
      :b-show-sidebar-toggle="props.showSidebarToggle"
      @toggle-sidebar="emit('toggle-sidebar')"
      @edit="openEditModal"
      @archive="toggleArchive"
      @delete="bShowDeleteModal = true"
    />

    <div
      v-if="error"
      class="mx-4 md:mx-6 mt-4 border border-destructive/50 bg-destructive/10 text-destructive px-4 py-3 shrink-0"
    >
      {{ error }}
    </div>

    <!-- Tab content -->
    <div class="flex-1 overflow-hidden flex flex-col min-h-0">
      <!-- Chat -->
      <div
        v-show="activeTab === 'chat'"
        class="flex-1 overflow-hidden flex flex-col min-h-0 lg:flex-row"
      >
        <div class="flex-1 min-w-0 flex flex-col min-h-0">
          <ChatMessageList
            ref="chatListRef"
            :b-loading="bLoading"
            :b-history-loaded="bHistoryLoaded"
            :display-messages="displayMessages"
            :streaming-display-items="streamingDisplayItems"
            :streaming-thinking-text="streamingThinkingText"
            :streaming-usage="streamingUsage"
            :b-is-streaming="bIsStreaming"
            :b-has-more="bHasMore"
            :b-loading-more="bLoadingMore"
            :chat-error="chatError"
            :chat-error-action-label="chatErrorActionLabel"
            :hide-thinking-output="hideThinkingOutput"
            :expanded-tool-output-ids="expandedToolOutputIds"
            :agent-type="session?.agentType"
            :user-name="auth.username"
            :viewport-height="viewportHeight"
            @load-older="chatSocket.loadOlderMessages"
            @toggle-tool-output="toggleToolOutput"
            @open-plan="planDocs.openPlan"
            @lightbox="(src) => (lightboxSrc = src)"
            @chat-error-action="handleChatErrorAction"
            @cancel="chatSocket.cancelPrompt"
          />

          <!-- Todo panel (mobile strip above the composer) -->
          <ChatTodoPanel
            v-if="bAnyTodos"
            layout="strip"
            class="lg:hidden"
            :todo-items="todoItems"
            :done-count="todoDoneCount"
            :b-running="bTodosRunning && bIsStreaming"
            :panel-state="todoPanelState"
            @toggle="toggleTodoPanelState"
          />

          <!-- Reconnecting indicator -->
          <div v-if="bWsReconnecting" class="flex justify-center py-1.5 shrink-0">
            <span class="text-xs text-text-muted flex items-center gap-1.5">
              <span
                class="w-3 h-3 border border-text-muted/40 border-t-text-muted rounded-full animate-spin inline-block"
              ></span>
              Reconnecting…
            </span>
          </div>

          <!-- Desktop: reopen chip when the todo panel is closed -->
          <div
            v-if="bAnyTodos && bTodoPanelClosed"
            class="hidden lg:flex justify-end px-4 pb-1 shrink-0"
          >
            <button
              type="button"
              class="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-fg/15 bg-fg/[0.02] text-xs text-text-muted hover:text-text-primary transition-colors"
              @click="openTodoPanel"
            >
              <span class="select-none" v-html="todoChecklistSvg" />
              Tasks {{ todoDoneCount }}/{{ todoItems.length }}
            </button>
          </div>

          <ChatComposer
            ref="composerRef"
            v-model:prompt-text="promptText"
            v-model:pending-images="pendingImages"
            :b-is-streaming="bIsStreaming"
            :b-ws-connected="bWsConnected"
            :queued-prompts="queuedPrompts"
            :mode-options="modeOptions"
            :display-session-mode="displaySessionMode"
            :selected-mode-label="selectedModeOption.label"
            :selected-mode-icon="selectedModeIconName"
            :b-modes-loading="bModesLoading"
            :b-saving-session-mode="bSavingSessionMode"
            :agent-type="session?.agentType"
            :model-selection="modelSelection"
            :model-options="modelOptions"
            :thinking-options="thinkingOptions"
            :thinking-value="thinkingOptions ? sessionConfig[thinkingOptions.configId] : null"
            :b-models-loading="bModelsLoading"
            :b-saving-model-selection="bSavingModelSelection"
            :b-selected-model-missing="bSelectedModelMissing"
            :agent-config-options="agentConfigOptions"
            :agent-config-display-value="agentConfigDisplayValue"
            :b-config-loading="bConfigLoading"
            :b-saving-session-config="bSavingSessionConfig"
            :hide-thinking-output="hideThinkingOutput"
            :b-md-up="bChatInputMdUp"
            :b-uploading-image="bUploadingImage"
            @send="onComposerSend"
            @cancel="chatSocket.cancelPrompt"
            @push-queue="chatSocket.pushQueuedPrompt"
            @delete-queue="chatSocket.deleteQueuedPrompt"
            @edit-queue="chatSocket.editQueuedPrompt"
            @select-mode="onSessionModeChange"
            @config-change="onAgentConfigChange"
            @model-update="onSharedModelPickerUpdate"
            @thinking-update="onSharedThinkingPickerUpdate"
            @hide-thinking-toggle="onHideThinkingToggle"
            @lightbox="(src) => (lightboxSrc = src)"
            @upload-files="onUploadFiles"
          />
        </div>

        <!-- Todo panel (desktop right column) -->
        <ChatTodoPanel
          v-if="bAnyTodos && !bTodoPanelClosed"
          layout="panel"
          class="hidden lg:flex lg:w-80 xl:w-96 shrink-0"
          :todo-items="todoItems"
          :done-count="todoDoneCount"
          :b-running="bTodosRunning && bIsStreaming"
          :panel-state="todoPanelState"
          b-closable
          @close="closeTodoPanel"
        />
      </div>

      <!-- Plan -->
      <div v-if="activeTab === 'plan'" class="flex-1 min-h-0 overflow-hidden flex flex-col bg-bg">
        <div
          class="shrink-0 border-b border-fg/10 px-4 md:px-6 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
        >
          <div class="min-w-0 sm:flex-1">
            <div v-if="planDocuments.length <= 1" class="flex items-center gap-2">
              <span class="truncate text-sm font-semibold text-text-primary">
                {{ selectedPlanDocument?.title ?? 'Plan' }}
              </span>
              <span
                v-if="selectedPlanDocument?.live"
                class="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
              >
                Live
              </span>
            </div>
            <div v-if="selectedPlanDocument" class="text-xs text-text-muted whitespace-nowrap">
              <template v-if="selectedPlanDocument.startableEntries.length">
                {{ selectedPlanDocument.completedCount }}/{{
                  selectedPlanDocument.startableEntries.length
                }}
                completed
              </template>
              <template v-else>Plan document</template>
            </div>
          </div>

          <div class="flex min-w-0 items-center gap-2 sm:ml-auto sm:shrink-0">
            <select
              v-if="planDocuments.length > 1"
              class="min-w-0 flex-1 max-w-none rounded-md border border-fg/15 bg-bg px-2 py-1 text-xs text-text-primary outline-none focus:border-primary sm:max-w-[12rem] sm:flex-none"
              :value="selectedPlanDocument?.id"
              aria-label="Select plan document"
              @change="selectedPlanId = ($event.target as HTMLSelectElement).value"
            >
              <option v-for="plan in planDocuments" :key="plan.id" :value="plan.id">
                {{ plan.title }}{{ plan.live ? ' (live)' : '' }}
              </option>
            </select>

            <div
              v-if="selectedPlanDocument"
              ref="planActionsMenuRef"
              class="relative inline-flex shrink-0"
            >
              <button
                type="button"
                class="button is-transparent rounded-r-none! text-xs"
                title="Download plan as Markdown"
                @click="
                  closePlanActionsMenu();
                  planDocs.downloadPlan(selectedPlanDocument);
                "
              >
                Download
              </button>
              <button
                type="button"
                class="button is-transparent is-icon rounded-l-none! border-l border-fg/10"
                title="Plan actions"
                aria-label="Plan actions"
                @click.stop="bPlanActionsMenuOpen = !bPlanActionsMenuOpen"
              >
                <ChevronDown class="h-3.5 w-3.5" />
              </button>
              <div
                v-if="bPlanActionsMenuOpen"
                class="absolute right-0 top-full z-30 mt-1 min-w-56 overflow-hidden rounded-lg border border-fg/10 bg-surface shadow-xl"
              >
                <button
                  type="button"
                  class="flex w-full items-center px-3 py-2 text-left text-xs text-text-primary hover:bg-fg/[0.06]"
                  @click="
                    closePlanActionsMenu();
                    planDocs.startSessionFromFullPlan(selectedPlanDocument);
                  "
                >
                  Start whole plan in new session
                </button>
                <button
                  type="button"
                  class="flex w-full items-center px-3 py-2 text-left text-xs text-text-primary hover:bg-fg/[0.06]"
                  @click="
                    closePlanActionsMenu();
                    planDocs.downloadPlan(selectedPlanDocument);
                  "
                >
                  Download markdown
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-6">
          <div v-if="selectedPlanDocument" class="mx-auto flex max-w-3xl flex-col gap-4">
            <div class="rounded-2xl border border-fg/10 bg-fg/[0.03] px-5 py-4 md:px-8 md:py-6">
              <div
                class="chat-markdown plan-markdown text-sm text-text-primary"
                v-html="selectedPlanDocument.renderedHtml"
                @click="planDocs.onPlanMarkdownClick"
              ></div>
            </div>
            <div
              v-if="selectedPlanDocument.startableEntries.length"
              class="rounded-2xl border border-fg/10 bg-fg/[0.03] overflow-hidden"
            >
              <div class="flex items-center gap-2 border-b border-fg/10 px-4 py-2.5">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="select-none text-text-muted shrink-0"
                  aria-hidden="true"
                >
                  <path
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12l2 2 4-4"
                  />
                </svg>
                <span class="text-xs font-medium text-text-primary">Plan points</span>
                <span class="ml-auto text-xs text-text-muted">
                  {{ selectedPlanDocument.completedCount }}/{{
                    selectedPlanDocument.startableEntries.length
                  }}
                </span>
              </div>
              <ul class="space-y-1.5 px-4 py-3">
                <li
                  v-for="(entry, index) in selectedPlanDocument.startableEntries"
                  :key="`${selectedPlanDocument.id}-todo-${index}`"
                  class="flex items-start gap-2 text-xs"
                >
                  <svg
                    v-if="planStatusIcon(entry.status) === 'completed'"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="text-green-500 select-none shrink-0 mt-px"
                    aria-hidden="true"
                  >
                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <svg
                    v-else-if="planStatusIcon(entry.status) === 'in_progress'"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="text-primary select-none shrink-0 mt-px"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <svg
                    v-else
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="text-text-muted select-none shrink-0 mt-px"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                  <span
                    class="min-w-0 flex-1 leading-snug"
                    :class="
                      isPlanEntryCompleted(entry.status)
                        ? 'text-text-muted line-through'
                        : 'text-text-primary'
                    "
                  >
                    {{ entry.content }}
                  </span>
                  <button
                    type="button"
                    class="shrink-0 rounded-md border border-fg/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
                    title="Start a new session from this plan point"
                    @click="planDocs.startSessionFromPlanEntry(selectedPlanDocument, entry, index)"
                  >
                    Start session
                  </button>
                </li>
              </ul>
            </div>
          </div>
          <div v-else class="h-full flex items-center justify-center text-sm text-text-muted">
            No plan has been created for this session yet.
          </div>
        </div>
      </div>

      <!-- Terminal -->
      <div v-if="activeTab === 'terminal'" class="flex-1 min-h-0 p-2 md:p-4">
        <AppTerminal :ws-url="sessionTerminalWsUrl" />
      </div>

      <!-- Files -->
      <FilesView
        v-if="activeTab === 'files'"
        :workspace-id="workspaceId"
        :active="activeTab === 'files'"
      />

      <!-- Git -->
      <GitView
        v-if="activeTab === 'git'"
        :workspace-id="workspaceId"
        :active="activeTab === 'git'"
      />
    </div>

    <!-- Bottom tabs -->
    <BottomTabBar
      :tabs="sessionTabs"
      :model-value="activeTab"
      @update:model-value="activeTab = $event as SessionTab"
    />

    <!-- Modals -->
    <SessionEditModal
      v-model="bShowEditModal"
      :session="session"
      :loading="bSavingEdit"
      :existing-tags="sessionTagSuggestions"
      @save="saveSessionEdit"
    />

    <ConfirmModal
      v-model="bShowDeleteModal"
      title="Delete session"
      eyebrow="// delete session"
      :description="`Delete '${session?.name ?? 'this session'}'? The chat history will be permanently removed.`"
      confirm-label="Delete"
      :loading="bDeletingSession"
      @confirm="deleteSession"
    />

    <!-- Image lightbox -->
    <Teleport to="body">
      <Transition name="lightbox">
        <div
          v-if="lightboxSrc"
          class="lightbox-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Attached image preview"
          @click.self="lightboxSrc = null"
        >
          <button
            type="button"
            class="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-fg/10 text-white hover:bg-fg/20 transition-colors"
            aria-label="Close image preview"
            @click="lightboxSrc = null"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <img
            :src="lightboxSrc"
            alt="Attached image preview"
            class="lightbox-img max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
          />
        </div>
      </Transition>
    </Teleport>
  </div>

  <!-- Claude Limit Popup -->
  <ClaudeLimitPopup
    :show="bShowClaudeLimitPopup"
    :reset-time="claudeLimitResetTime"
    :reset-time-readable="claudeLimitResetTimeReadable"
    :initial-auto-continue="bClaudeAutoContinueEnabled"
    @update:show="bShowClaudeLimitPopup = $event"
    @auto-continue-updated="handleAutoContinueUpdated"
  />
</template>

<style scoped>
.lightbox-enter-active,
.lightbox-leave-active {
  transition: opacity 0.22s ease;
}

.lightbox-enter-active .lightbox-img,
.lightbox-leave-active .lightbox-img {
  transition:
    transform 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.22s ease;
}

.lightbox-enter-from,
.lightbox-leave-to {
  opacity: 0;
}

.lightbox-enter-from .lightbox-img,
.lightbox-leave-to .lightbox-img {
  opacity: 0;
  transform: scale(0.94);
}

.lightbox-enter-to .lightbox-img,
.lightbox-leave-from .lightbox-img {
  opacity: 1;
  transform: scale(1);
}

.plan-markdown {
  line-height: 1.65;
}

.plan-markdown :deep(h1),
.plan-markdown :deep(h2),
.plan-markdown :deep(h3) {
  color: var(--color-text-primary);
  font-weight: 700;
  line-height: 1.25;
}

.plan-markdown :deep(h1) {
  margin: 0 0 1rem;
  font-size: 1.5rem;
}

.plan-markdown :deep(h2) {
  margin: 1.5rem 0 0.65rem;
  padding-top: 0.75rem;
  border-top: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  font-size: 1.125rem;
}

.plan-markdown :deep(h3) {
  margin: 1.15rem 0 0.5rem;
  font-size: 0.98rem;
}

.plan-markdown :deep(p),
.plan-markdown :deep(ul),
.plan-markdown :deep(ol),
.plan-markdown :deep(blockquote),
.plan-markdown :deep(pre) {
  margin: 0.65rem 0;
}

.plan-markdown :deep(ul),
.plan-markdown :deep(ol) {
  padding-left: 1.25rem;
}

.plan-markdown :deep(ul) {
  list-style: disc;
}

.plan-markdown :deep(ol) {
  list-style: decimal;
}

.plan-markdown :deep(li) {
  margin: 0.35rem 0;
  padding-left: 0.15rem;
}

.plan-markdown :deep(.plan-start-actions-card) {
  margin: 1.25rem 0 0;
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  border-radius: 0.85rem;
  background: color-mix(in srgb, var(--color-fg) 4%, transparent);
  overflow: hidden;
}

.plan-markdown :deep(.plan-start-actions-title) {
  border-bottom: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  padding: 0.65rem 0.85rem;
  color: var(--color-text-primary);
  font-size: 0.78rem;
  font-weight: 700;
}

.plan-markdown :deep(.plan-start-actions-card ol) {
  margin: 0;
  padding: 0.5rem 0.75rem;
  list-style: none;
}

.plan-markdown :deep(.plan-start-action-row) {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  margin: 0;
  padding: 0.45rem 0;
}

.plan-markdown :deep(.plan-start-action-row + .plan-start-action-row) {
  border-top: 1px solid color-mix(in srgb, var(--color-fg) 8%, transparent);
}

.plan-markdown :deep(.plan-start-action-row span) {
  min-width: 0;
  flex: 1;
  line-height: 1.35;
}

.plan-markdown :deep(.plan-start-action-inline) {
  margin: -0.25rem 0 0.75rem;
}

.plan-markdown :deep(.plan-start-session-btn) {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  border: 1px solid color-mix(in srgb, var(--color-primary) 25%, transparent);
  border-radius: 0.45rem;
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  padding: 0.3rem 0.5rem;
  color: var(--color-primary);
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1;
  vertical-align: middle;
}

.plan-markdown :deep(.plan-start-session-btn:hover) {
  background: color-mix(in srgb, var(--color-primary) 16%, transparent);
}

.plan-markdown :deep(strong) {
  color: var(--color-text-primary);
  font-weight: 700;
}

.plan-markdown :deep(blockquote) {
  border-left: 3px solid color-mix(in srgb, var(--color-fg) 18%, transparent);
  padding-left: 0.9rem;
  color: var(--color-text-muted);
}

.plan-markdown :deep(code) {
  border-radius: 0.35rem;
  background: color-mix(in srgb, var(--color-fg) 8%, transparent);
  padding: 0.1rem 0.3rem;
  font-size: 0.86em;
}

.plan-markdown :deep(pre) {
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--color-fg) 6%, transparent);
  padding: 0.85rem 1rem;
}

.plan-markdown :deep(pre code) {
  background: transparent;
  padding: 0;
}
</style>
