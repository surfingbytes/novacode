<script setup lang="ts">
// node_modules
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
import SessionPlanTab from '@/components/chat/SessionPlanTab.vue';
import ImageLightbox from '@/components/chat/ImageLightbox.vue';
import EntityDetailHeader from '@/components/ui/EntityDetailHeader.vue';
import BottomTabBar from '@/components/ui/BottomTabBar.vue';

// classes
import { sessionsApi, settingsApi, workspaceRulesApi, buildSessionTerminalWsUrl } from '@/classes/api';
import { renderMermaidDiagrams } from '@/lib/mermaid';
import { clearSessionPrompt, persistSessionPrompt, readSessionPrompt } from '@/lib/pendingSessionPrompt';
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/lib/safeLocalStorage';
import { readSessionCache, writeSessionCache } from '@/lib/sessionCache';
import { sessionChatToMarkdown, sessionExportFilename } from '@/utils/sessionChatMarkdown';
import {
  getToolIconSvg,
  parseHistoryEventsCached,
  prepareDisplayItem,
  renderMdCached
} from '@/utils/chatDisplayItems';
import { toWorkspaceRelativePath } from '@/utils/workspaceFilePath';
import { setViewingSession } from '@/utils/sessionUnread';
import { formatSessionCostLabel, resolveSessionCostAmount } from '@/utils/sessionUsageDisplay';

// composables
import { useAgentOptions } from '@/composables/useAgentOptions';
import { useChatSocket } from '@/composables/useChatSocket';
import { usePaneLayout } from '@/composables/usePaneLayout';
import { usePlanDocuments } from '@/composables/usePlanDocuments';
import { useTodoList } from '@/composables/useTodoList';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';
import { useToastStore } from '@/stores/toasts';
import { useAuthStore } from '@/stores/auth';

// types
import type {
  ApprovalPolicy,
  ChatMessage,
  LinkedPlanContext,
  Session,
  SessionUsageSummary,
  SessionUsageTurn
} from '@/@types/index';

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
  (e: 'new-session'): void;
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
const route = useRoute();
const workspacesStore = useWorkspacesStore();
const toastStore = useToastStore();
const auth = useAuthStore();

// -------------------------------------------------- Refs --------------------------------------------------
// Last-known snapshot for this session (chat + plan) — shown instantly while
// REST/WebSocket revalidate, so a cold start on a poor connection doesn't
// stare at a skeleton for data the app already had.
const initialCache = readSessionCache(props.workspaceId, props.sessionId);
const session = ref<Session | null>(initialCache?.session ?? null);
const usageTurns = ref<SessionUsageTurn[]>([]);
const usageSummary = ref<SessionUsageSummary | null>(null);
const bLoading = ref(!initialCache);
const error = ref<string | null>(null);
const bShowEditModal = ref(false);
const bSavingEdit = ref(false);
const bShowDeleteModal = ref(false);
const bDeletingSession = ref(false);
const bShowDeletePlanModal = ref(false);
const bDeletingPlan = ref(false);
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
const HIDE_TOOL_CALLS_LS_KEY = 'nova:chat:hideToolCalls';
const hideThinkingOutput = ref(readHideThinkingFromLs());
const hideToolCalls = ref(readHideToolCallsFromLs());

function readHideThinkingFromLs(): boolean {
  return safeGetItem(HIDE_THINKING_LS_KEY) === '1';
}

function readHideToolCallsFromLs(): boolean {
  return safeGetItem(HIDE_TOOL_CALLS_LS_KEY) === '1';
}

function persistChatToggle(key: string, checked: boolean): void {
  if (checked) safeSetItem(key, '1');
  else safeRemoveItem(key);
}

function onHideThinkingToggle(checked: boolean): void {
  hideThinkingOutput.value = checked;
  if (checked) chatSocket.streamingThinkingText.value = '';
  persistChatToggle(HIDE_THINKING_LS_KEY, checked);
}

function onHideToolCallsToggle(checked: boolean): void {
  hideToolCalls.value = checked;
  persistChatToggle(HIDE_TOOL_CALLS_LS_KEY, checked);
}

const approvalPolicy = ref<ApprovalPolicy>('ask');
const bSavingApprovalPolicy = ref(false);
let approvalPolicySaveSeq = 0;

function normalizeApprovalPolicy(value: string | null | undefined): ApprovalPolicy {
  return value === 'allow_all' ? 'allow_all' : 'ask';
}

async function onApprovalPolicyChange(policy: ApprovalPolicy): Promise<void> {
  if (!session.value || policy === approvalPolicy.value) return;
  const seq = ++approvalPolicySaveSeq;
  const prev = approvalPolicy.value;
  const prevSession = session.value;
  approvalPolicy.value = policy;
  session.value = { ...session.value, approvalPolicy: policy };
  bSavingApprovalPolicy.value = true;
  try {
    const { data: updated } = await sessionsApi.update(props.workspaceId, props.sessionId, {
      approvalPolicy: policy
    });
    if (seq !== approvalPolicySaveSeq) return;
    session.value = updated;
    approvalPolicy.value = normalizeApprovalPolicy(updated.approvalPolicy);
  } catch {
    if (seq !== approvalPolicySaveSeq) return;
    approvalPolicy.value = prev;
    session.value = prevSession;
    toastStore.error('Failed to update approval policy');
  } finally {
    if (seq === approvalPolicySaveSeq) bSavingApprovalPolicy.value = false;
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
const filesOpenPath = ref<string | null>(null);
const rulesCount = ref(0);

let mermaidRenderTimer: ReturnType<typeof setTimeout> | null = null;
let fetchSessionSeq = 0;
/** True while a cached snapshot is on screen and the first fresh history frame is pending. */
let bCachedHistoryOnScreen = !!initialCache;

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

// The cached session already carries agentType/model/mode/config — apply it and
// fetch model/mode options now instead of waiting on the session revalidation.
if (initialCache?.session) {
  agentOptions.applyFetchedSession(initialCache.session);
  approvalPolicy.value = normalizeApprovalPolicy(initialCache.session.approvalPolicy);
  void loadAgentOptions();
}

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
    // A cached snapshot is already on screen: the list's pinned-bottom follow
    // keeps the view correct — don't yank the user if they scrolled up to read.
    if (bCachedHistoryOnScreen) {
      bCachedHistoryOnScreen = false;
      return;
    }
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
    void fetchUsageTurns();
  },
  onMessagesChanged: () => {
    // Server-confirmed message state — emptiness here is authoritative.
    scheduleSessionCachePersist(true);
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
  pendingApprovals,
  pendingQuestions,
  bHasMore,
  bLoadingMore,
  bHistoryLoaded,
  bWsConnected,
  bWsReconnecting
} = chatSocket;

watch(
  () => session.value?.lastUsage,
  (usage) => {
    if (usage && !bIsStreaming.value && streamingUsage.value == null) {
      streamingUsage.value = usage;
    }
  },
  { immediate: true }
);

// -------------------------------------------------- Session snapshot cache --------------------------------------------------
let persistCacheTimer: ReturnType<typeof setTimeout> | null = null;
let persistCacheAllowEmpty = false;

function persistSessionCache(allowEmptyMessages = false): void {
  writeSessionCache(
    props.workspaceId,
    props.sessionId,
    {
      session: session.value,
      messages: messages.value,
      bHasMore: bHasMore.value
    },
    { allowEmptyMessages }
  );
}

function scheduleSessionCachePersist(allowEmptyMessages = false): void {
  persistCacheAllowEmpty = persistCacheAllowEmpty || allowEmptyMessages;
  if (persistCacheTimer !== null) {
    clearTimeout(persistCacheTimer);
  }
  persistCacheTimer = setTimeout(() => {
    persistCacheTimer = null;
    const allow = persistCacheAllowEmpty;
    persistCacheAllowEmpty = false;
    persistSessionCache(allow);
  }, 400);
}

watch(session, () => {
  scheduleSessionCachePersist();
});

watch(
  () => workspacesStore.allSessions.find((storeSession) => storeSession.id === props.sessionId)?.name,
  (storeName) => {
    if (!session.value || storeName === undefined) {
      return;
    }
    if (session.value.name === storeName) {
      return;
    }
    session.value = { ...session.value, name: storeName };
  }
);

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
    emit('start-plan-session', payload);
  }
});
const { selectedPlanId, planDocuments, selectedPlanDocument, bShowPlanTab } = planDocs;

// -------------------------------------------------- Todo list panel --------------------------------------------------
const todoChecklistSvg = getToolIconSvg('checklist');
const { bWidePane } = usePaneLayout();
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
  clearSessionPrompt(props.workspaceId, props.sessionId);
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
const workspacePath = computed(
  () => workspacesStore.workspaces.find((w) => w.id === props.workspaceId)?.path ?? ''
);
const subtitleWorkspaces = computed(() =>
  workspacesStore.workspaces
    .filter((workspace) => !workspace.archived)
    .map((workspace) => ({ id: workspace.id, name: workspace.name }))
    .sort((left, right) => left.name.localeCompare(right.name))
);
const sessionCostLabel = computed(() => {
  const amount = resolveSessionCostAmount({
    persistedAmount: usageSummary.value?.costAmount,
    liveAmount: streamingUsage.value?.cost?.amount,
    bStreaming: bIsStreaming.value
  });
  if (amount == null) {
    return null;
  }
  return formatSessionCostLabel(
    amount,
    streamingUsage.value?.cost?.currency ?? usageSummary.value?.costCurrency
  );
});
const rulesSubtitleLabel = computed(() => {
  if (rulesCount.value <= 0) {
    return null;
  }
  return `${rulesCount.value} rule${rulesCount.value === 1 ? '' : 's'}`;
});

function tabFromQuery(raw: unknown): SessionTab | null {
  if (raw === 'chat' || raw === 'terminal' || raw === 'files' || raw === 'git' || raw === 'plan') {
    return raw;
  }
  return null;
}

function applySessionQueryFromRoute(): void {
  const tab = tabFromQuery(route.query.tab);
  if (tab && tab !== activeTab.value) {
    activeTab.value = tab;
  }
  const file = route.query.file;
  if (typeof file === 'string' && file.trim()) {
    filesOpenPath.value = file;
    if (!tab) {
      activeTab.value = 'files';
    }
  }
}

function syncSessionQuery(): void {
  const nextQuery: Record<string, string> = {};
  if (activeTab.value !== 'chat') {
    nextQuery.tab = activeTab.value;
  }
  if (activeTab.value === 'files' && filesOpenPath.value) {
    nextQuery.file = filesOpenPath.value;
  }
  const currentTab = typeof route.query.tab === 'string' ? route.query.tab : '';
  const currentFile = typeof route.query.file === 'string' ? route.query.file : '';
  if ((nextQuery.tab ?? '') === currentTab && (nextQuery.file ?? '') === currentFile) {
    return;
  }
  void router.replace({ query: nextQuery });
}

function openWorkspaceFile(rawPath: string): void {
  const relative =
    toWorkspaceRelativePath(rawPath, workspacePath.value) ??
    rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!relative || relative.includes('*')) {
    return;
  }
  filesOpenPath.value = relative;
  activeTab.value = 'files';
  syncSessionQuery();
}

function onFilesOpenPath(path: string | null): void {
  filesOpenPath.value = path;
  syncSessionQuery();
}

function onSelectWorkspace(workspaceId: string): void {
  if (workspaceId === props.workspaceId) {
    return;
  }
  void router.push({ name: 'workspace-sessions', params: { id: workspaceId } });
}

async function loadRulesCount(): Promise<void> {
  try {
    const { data } = await workspaceRulesApi.list(props.workspaceId);
    rulesCount.value = Array.isArray(data) ? data.length : 0;
  } catch {
    rulesCount.value = 0;
  }
}
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

// ── Session edit/delete/archive ──────────────────────────────────────────────
function openEditModal(): void {
  bShowEditModal.value = true;
}

function exportSessionMarkdown(): void {
  const title = session.value?.name?.trim() || 'Untitled session';
  const markdown = sessionChatToMarkdown(messages.value, {
    title,
    workspaceName: workspaceName.value
  });
  if (!markdown.includes('\n## ')) {
    toastStore.info('Nothing to export yet');
    return;
  }
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = sessionExportFilename(title);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  toastStore.success('Exported Markdown');
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

async function deleteSelectedPlan(): Promise<void> {
  const plan = selectedPlanDocument.value;
  if (!plan) return;
  bDeletingPlan.value = true;
  try {
    await planDocs.deletePlan(plan);
    bShowDeletePlanModal.value = false;
  } catch {
    toastStore.error('Failed to delete plan');
  } finally {
    bDeletingPlan.value = false;
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
    approvalPolicy.value = normalizeApprovalPolicy(response.data.approvalPolicy);
    void loadAgentOptions();
    void fetchUsageTurns();
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
  bClaudeAutoContinueEnabled.value = enabled;
}

async function fetchUsageTurns(): Promise<void> {
  try {
    const response = await sessionsApi.listUsage(props.workspaceId, props.sessionId);
    usageTurns.value = response.data.turns;
    usageSummary.value = response.data.summary ?? null;
    const latest = usageTurns.value[0];
    if (latest && !bIsStreaming.value && streamingUsage.value == null) {
      streamingUsage.value = latest;
    }
  } catch {
    // Usage is optional; agents that never emit usage_update leave this empty.
  }
}

// -------------------------------------------------- Watchers --------------------------------------------------
watch(activeTab, (tab) => {
  syncSessionQuery();
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

watch(
  () => [route.query.tab, route.query.file],
  () => {
    applySessionQueryFromRoute();
  }
);

watch(
  () => props.sessionId,
  (sessionId) => {
    setViewingSession(sessionId);
  },
  { immediate: true }
);

watch(
  () => props.workspaceId,
  () => {
    void loadRulesCount();
  },
  { immediate: true }
);

watch(promptText, (val) => {
  persistSessionPrompt(props.workspaceId, props.sessionId, val);
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
    usageTurns.value = [];
    usageSummary.value = null;
    expandedToolOutputIds.value = new Set();
    filesOpenPath.value = null;
    const queryTab = tabFromQuery(route.query.tab);
    activeTab.value = queryTab ?? 'chat';
    const cached = readSessionCache(props.workspaceId, newId);
    session.value = cached?.session ?? null;
    bCachedHistoryOnScreen = !!cached;
    if (cached) {
      chatSocket.hydrateHistory(cached.messages, cached.bHasMore);
    }
    bLoading.value = !cached;
    pendingImages.value = [];
    agentOptions.resetAgentOptions();
    approvalPolicy.value = normalizeApprovalPolicy(cached?.session?.approvalPolicy);
    if (cached?.session) {
      agentOptions.applyFetchedSession(cached.session);
      void loadAgentOptions();
    }
    if (cached?.messages.length) {
      void nextTick(() => chatListRef.value?.forceInitialScrollToBottom());
    }

    const savedPrompt = readSessionPrompt(props.workspaceId, newId);
    promptText.value = savedPrompt ?? '';

    // Fetch and socket run in parallel — the WS history frame must not wait on
    // the REST round-trip (a hung fetch would otherwise block chat + sending).
    void fetchSession();
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

  const savedPrompt = readSessionPrompt(props.workspaceId, props.sessionId);
  if (savedPrompt != null) promptText.value = savedPrompt;

  // Fetch and socket run in parallel — the WS history frame must not wait on
  // the REST round-trip (a hung fetch would otherwise block chat + sending).
  void fetchSession();
  chatSocket.connect();
  if (initialCache?.messages.length) {
    void nextTick(() => chatListRef.value?.forceInitialScrollToBottom());
  }
  try {
    const { data } = await settingsApi.get();
    if (typeof data.claudeAutoContinue === 'boolean') {
      bClaudeAutoContinueEnabled.value = data.claudeAutoContinue;
    }
  } catch {
    // keep defaults
  }
  scheduleMermaidRender();
  applySessionQueryFromRoute();
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
  persistSessionCache(persistCacheAllowEmpty);
  persistCacheAllowEmpty = false;
  if (chatInputMql) {
    chatInputMql.removeEventListener('change', syncChatInputBreakpoint);
    chatInputMql = null;
  }
  planDocs.clearPlanDocumentsRefreshTimers();
  chatSocket.disconnect();
  setViewingSession(null);
});
</script>

<template>
  <div ref="sessionChatRootRef" class="flex-1 flex flex-col overflow-hidden">
    <!-- Header -->
    <EntityDetailHeader
      :title="session?.name?.trim() || 'Untitled session'"
      :subtitle="workspaceName"
      :subtitle-items="subtitleWorkspaces"
      :current-subtitle-id="workspaceId"
      :tags="session?.tags ?? []"
      :b-loading="bLoading"
      :archived="session?.archived ?? false"
      :b-show-sidebar-toggle="props.showSidebarToggle"
      :show-new-session="true"
      :show-export="true"
      @toggle-sidebar="emit('toggle-sidebar')"
      @new-session="emit('new-session')"
      @edit="openEditModal"
      @export="exportSessionMarkdown"
      @select-subtitle="onSelectWorkspace"
      @archive="toggleArchive"
      @delete="bShowDeleteModal = true"
    >
      <template #subtitle-trailing>
        <template v-if="sessionCostLabel">
          <span class="text-text-muted/40 shrink-0" aria-hidden="true">·</span>
          <span class="shrink-0 tabular-nums" :title="sessionCostLabel">{{ sessionCostLabel }}</span>
        </template>
        <RouterLink
          v-if="rulesSubtitleLabel"
          :to="{ name: 'workspace-rules', params: { id: workspaceId } }"
          class="md:hidden inline-flex items-center gap-1 min-w-0 hover:text-text-primary"
        >
          <span class="text-text-muted/40 shrink-0" aria-hidden="true">·</span>
          <span class="truncate">{{ rulesSubtitleLabel }}</span>
        </RouterLink>
      </template>
    </EntityDetailHeader>

    <div
      v-if="rulesCount > 0 && activeTab === 'chat'"
      class="hidden md:block px-4 md:px-6 py-1.5 border-b border-fg/10 shrink-0"
    >
      <RouterLink
        :to="{ name: 'workspace-rules', params: { id: workspaceId } }"
        class="text-[11px] text-text-muted hover:text-text-primary"
      >
        Using {{ rulesCount }} workspace rule{{ rulesCount === 1 ? '' : 's' }}
      </RouterLink>
    </div>

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
        class="flex-1 overflow-hidden flex min-h-0"
        :class="bWidePane ? 'flex-row' : 'flex-col'"
      >
        <div class="flex-1 min-w-0 flex flex-col min-h-0">
          <ChatMessageList
            ref="chatListRef"
            :b-loading="bLoading"
            :b-history-loaded="bHistoryLoaded"
            :display-messages="displayMessages"
            :streaming-display-items="streamingDisplayItems"
            :pending-approvals="pendingApprovals"
            :pending-questions="pendingQuestions"
            :streaming-thinking-text="streamingThinkingText"
            :streaming-usage="streamingUsage"
            :usage-turns="usageTurns"
            :b-is-streaming="bIsStreaming"
            :b-has-more="bHasMore"
            :b-loading-more="bLoadingMore"
            :chat-error="chatError"
            :chat-error-action-label="chatErrorActionLabel"
            :hide-thinking-output="hideThinkingOutput"
            :hide-tool-calls="hideToolCalls"
            :expanded-tool-output-ids="expandedToolOutputIds"
            :agent-type="session?.agentType"
            :user-name="auth.username"
            :viewport-height="viewportHeight"
            @load-older="chatSocket.loadOlderMessages"
            @toggle-tool-output="toggleToolOutput"
            @open-plan="planDocs.openPlan"
            @open-file="openWorkspaceFile"
            @lightbox="(src) => (lightboxSrc = src)"
            @chat-error-action="handleChatErrorAction"
            @approval-response="chatSocket.sendApprovalResponse"
            @question-response="chatSocket.sendQuestionResponse"
          />

          <!-- Todo panel (narrow: strip above the composer) -->
          <ChatTodoPanel
            v-if="bAnyTodos && !bWidePane"
            layout="strip"
            :todo-items="todoItems"
            :done-count="todoDoneCount"
            :b-running="bTodosRunning && bIsStreaming"
            :panel-state="todoPanelState"
            @toggle="toggleTodoPanelState"
          />

          <!-- Connection indicator (initial connect and reconnects) -->
          <div v-if="!bWsConnected" class="flex justify-center py-1.5 shrink-0">
            <span class="text-xs text-text-muted flex items-center gap-1.5">
              <span
                class="w-3 h-3 border border-text-muted/40 border-t-text-muted rounded-full animate-spin inline-block"
              ></span>
              {{ bWsReconnecting ? 'Reconnecting…' : 'Connecting…' }}
            </span>
          </div>

          <!-- Wide: reopen chip when the todo panel is closed -->
          <div
            v-if="bAnyTodos && bTodoPanelClosed && bWidePane"
            class="flex justify-end px-4 pb-1 shrink-0"
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
            :hide-tool-calls="hideToolCalls"
            :approval-policy="approvalPolicy"
            :b-saving-approval-policy="bSavingApprovalPolicy"
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
            @hide-tool-calls-toggle="onHideToolCallsToggle"
            @approval-policy-change="onApprovalPolicyChange"
            @lightbox="(src) => (lightboxSrc = src)"
            @upload-files="onUploadFiles"
          />
        </div>

        <!-- Todo panel (wide: right column) -->
        <ChatTodoPanel
          v-if="bAnyTodos && !bTodoPanelClosed && bWidePane"
          layout="panel"
          class="flex w-80 xl:w-96 shrink-0"
          :todo-items="todoItems"
          :done-count="todoDoneCount"
          :b-running="bTodosRunning && bIsStreaming"
          :panel-state="todoPanelState"
          b-closable
          @close="closeTodoPanel"
        />
      </div>

      <SessionPlanTab
        v-if="activeTab === 'plan'"
        :plan-documents="planDocuments"
        :selected-plan-document="selectedPlanDocument"
        @select="selectedPlanId = $event"
        @download="planDocs.downloadPlan"
        @delete="bShowDeletePlanModal = true"
        @start-full-plan="planDocs.startSessionFromFullPlan"
        @start-plan-entry="({ plan, entry, index }) => planDocs.startSessionFromPlanEntry(plan, entry, index)"
        @markdown-click="planDocs.onPlanMarkdownClick"
      />

      <!-- Terminal -->
      <div v-if="activeTab === 'terminal'" class="flex-1 min-h-0 p-2 md:p-4">
        <AppTerminal :ws-url="sessionTerminalWsUrl" />
      </div>

      <!-- Files -->
      <FilesView
        v-if="activeTab === 'files'"
        class="flex-1 min-h-0"
        :workspace-id="workspaceId"
        :active="activeTab === 'files'"
        :open-path="filesOpenPath"
        @update:open-path="onFilesOpenPath"
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

    <ConfirmModal
      v-model="bShowDeletePlanModal"
      title="Delete plan"
      eyebrow="// delete plan"
      :description="
        selectedPlanDocument?.backendPlanId
          ? `Delete '${selectedPlanDocument.title}'? The plan file will be permanently removed.`
          : `Remove '${selectedPlanDocument?.title ?? 'this plan'}' from the Plan tab?`
      "
      confirm-label="Delete"
      :loading="bDeletingPlan"
      @confirm="deleteSelectedPlan"
    />

    <ImageLightbox v-model="lightboxSrc" />
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

