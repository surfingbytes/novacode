<script setup lang="ts">
// node_modules
import { ref, computed, onMounted, onUnmounted, nextTick, watch, defineAsyncComponent } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
// components
import OrchestratorPanel from '@/components/OrchestratorPanel.vue';
import ClaudeLimitPopup from '@/components/ClaudeLimitPopup.vue';
import ConfirmModal from '@/components/ConfirmModal.vue';
import ChatHandoffBanner from '@/components/chat/ChatHandoffBanner.vue';
import ChatMessageList from '@/components/chat/ChatMessageList.vue';
import ChatComposer from '@/components/chat/ChatComposer.vue';
import ChatStatusRows from '@/components/chat/ChatStatusRows.vue';
import ChatTodoPanel from '@/components/chat/ChatTodoPanel.vue';
import SessionChatHeader from '@/components/chat/SessionChatHeader.vue';
import SessionChatModals from '@/components/chat/SessionChatModals.vue';
import SessionPlanTab from '@/components/chat/SessionPlanTab.vue';
import ImageLightbox from '@/components/chat/ImageLightbox.vue';
import BottomTabBar from '@/components/ui/BottomTabBar.vue';

// classes
import { buildSessionTerminalWsUrl } from '@/classes/api';
import { clearSessionPrompt, persistSessionPrompt, readSessionPrompt } from '@/lib/pendingSessionPrompt';
import { readSessionCache } from '@/lib/sessionCache';

// composables
import { useAgentOptions } from '@/composables/useAgentOptions';
import { useApprovalPolicy } from '@/composables/useApprovalPolicy';
import { useChatAttachments } from '@/composables/useChatAttachments';
import { useChatDisplayItems } from '@/composables/useChatDisplayItems';
import { useChatErrorAction } from '@/composables/useChatErrorAction';
import { useChatInputBreakpoint } from '@/composables/useChatInputBreakpoint';
import { useChatSocket } from '@/composables/useChatSocket';
import { useChatViewToggles } from '@/composables/useChatViewToggles';
import { useClaudeLimitPopup } from '@/composables/useClaudeLimitPopup';
import { useMermaidRender } from '@/composables/useMermaidRender';
import { usePaneLayout } from '@/composables/usePaneLayout';
import { usePlanDocuments, type StartPlanSessionPayload } from '@/composables/usePlanDocuments';
import { useSessionActions } from '@/composables/useSessionActions';
import { useSessionHandoff } from '@/composables/useSessionHandoff';
import { useSessionHeaderInfo } from '@/composables/useSessionHeaderInfo';
import { useSessionLoader } from '@/composables/useSessionLoader';
import { useSessionOrchestrator } from '@/composables/useSessionOrchestrator';
import { useSessionSnapshotCache } from '@/composables/useSessionSnapshotCache';
import { tabFromQuery, useSessionTabs, type SessionTab } from '@/composables/useSessionTabs';
import { useSessionUsage } from '@/composables/useSessionUsage';
import { useStoreSessionSync } from '@/composables/useStoreSessionSync';
import { useTodoList } from '@/composables/useTodoList';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';
import { useToastStore } from '@/stores/toasts';
import { useAuthStore } from '@/stores/auth';
import { useApiHealthStore } from '@/stores/apiHealth';
import { useOrchestratorsStore } from '@/stores/orchestrators';

// types
import type { Session } from '@/@types/index';

// tab-only views load lazily so the session chunk stays small
const FilesView = defineAsyncComponent(() => import('@/components/workspace/FilesComponent.vue'));
const GitView = defineAsyncComponent(() => import('@/components/workspace/GitView.vue'));
const AppTerminal = defineAsyncComponent(() => import('@/components/AppTerminal.vue'));

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
  (e: 'start-plan-session', payload: StartPlanSessionPayload): void;
}>();

// -------------------------------------------------- Store --------------------------------------------------
const router = useRouter();
const route = useRoute();
const workspacesStore = useWorkspacesStore();
const toastStore = useToastStore();
const apiHealth = useApiHealthStore();
const { bApiReachable, healthyPingCount } = storeToRefs(apiHealth);
const auth = useAuthStore();
const orchestratorsStore = useOrchestratorsStore();

// -------------------------------------------------- Refs --------------------------------------------------
// Last-known snapshot for this session (chat + plan) — shown instantly while
// REST/WebSocket revalidate, so a cold start on a poor connection doesn't
// stare at a skeleton for data the app already had.
const initialCache = readSessionCache(props.workspaceId, props.sessionId);
const session = ref<Session | null>(initialCache?.session ?? null);
const sessionChatRootRef = ref<HTMLElement | null>(null);
const chatListRef = ref<InstanceType<typeof ChatMessageList>>();
const composerRef = ref<InstanceType<typeof ChatComposer>>();
const lightboxSrc = ref<string | null>(null);

const {
  bShowClaudeLimitPopup,
  claudeLimitResetTime,
  claudeLimitResetTimeReadable,
  bClaudeAutoContinueEnabled,
  onClaudeLimitDetected,
  handleAutoContinueUpdated,
  loadClaudeAutoContinueSetting
} = useClaudeLimitPopup();

const {
  hideThinkingOutput,
  hideToolCalls,
  expandedToolOutputIds,
  onHideThinkingToggle,
  onHideToolCallsToggle,
  toggleToolOutput,
  collapseAllToolOutputs
} = useChatViewToggles({
  onThinkingHidden: () => {
    chatSocket.streamingThinkingText.value = '';
  }
});

const { approvalPolicy, bSavingApprovalPolicy, applySessionApprovalPolicy, onApprovalPolicyChange } =
  useApprovalPolicy({
    workspaceId: () => props.workspaceId,
    sessionId: () => props.sessionId,
    session
  });

const {
  activeTab,
  filesOpenPath,
  applySessionQueryFromRoute,
  syncSessionQuery,
  openWorkspaceFile,
  onFilesOpenPath
} = useSessionTabs({
  workspaceId: () => props.workspaceId,
  workspacePath: () => workspacePath.value,
  route,
  router
});

/** True while a cached snapshot is on screen and the first fresh history frame is pending. */
let bCachedHistoryOnScreen = !!initialCache;
const { scheduleMermaidRender } = useMermaidRender(sessionChatRootRef);

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
  applySessionApprovalPolicy(initialCache.session.approvalPolicy);
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
  onPlanApprovalRequested: () => {
    // Plan body is on the Plan tab; keep chat selected only when the user must
    // click an approval option (Ask policy). Allow-all already auto-accepted.
    if (approvalPolicy.value === 'ask') {
      activeTab.value = 'chat';
      return;
    }
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
  onClaudeLimitDetected,
  onHandoffReady: (newSessionId) => openHandoffTarget(newSessionId),
  onHandoffFailed: (message) => failHandoff(message)
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

// -------------------------------------------------- Session snapshot cache --------------------------------------------------
const { scheduleSessionCachePersist, cancelSessionCachePersist, flushSessionCache } =
  useSessionSnapshotCache({
    workspaceId: () => props.workspaceId,
    sessionId: () => props.sessionId,
    session,
    messages,
    bHasMore
  });

const { liveBusySubagents } = useStoreSessionSync({
  sessionId: () => props.sessionId,
  session,
  workspacesStore
});

// -------------------------------------------------- Display items --------------------------------------------------
const { displayMessages, streamingDisplayItems } = useChatDisplayItems({ messages, streamingItems });

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
/** Text of a sent message waiting for "Replace current draft?" confirmation. */
const pendingEditText = ref<string | null>(null);
const bShowReplaceDraftModal = computed({
  get: (): boolean => pendingEditText.value !== null,
  set: (value: boolean): void => {
    if (!value) {
      pendingEditText.value = null;
    }
  }
});
/** Sent user prompts (oldest → newest) for ArrowUp/ArrowDown recall in the composer. */
const promptHistory = computed((): string[] => {
  const history: string[] = [];
  for (const entry of displayMessages.value) {
    if (entry.msg.role !== 'user') {
      continue;
    }
    const text = entry.msg.content?.trim();
    if (!text || history[history.length - 1] === text) {
      continue;
    }
    history.push(text);
  }
  return history;
});
const { pendingImages, bUploadingImage, onUploadFiles } = useChatAttachments({
  sessionId: () => props.sessionId,
  onUploadError: (message) => chatSocket.setChatError(message)
});
const { bChatInputMdUp } = useChatInputBreakpoint();

// -------------------------------------------------- Orchestrator mode --------------------------------------------------
const {
  plannedOrchestrator,
  bPlanHasSteps,
  loadPlannedOrchestrator,
  planAsOrchestrator,
  openOrchestratorPage
} = useSessionOrchestrator({
  workspaceId: () => props.workspaceId,
  sessionId: () => props.sessionId,
  router,
  orchestratorsStore,
  activeTab,
  sendPrompt: (text) =>
    chatSocket.sendPrompt({
      text,
      model: modelSelection.value,
      mode: displaySessionMode.value,
      imagePaths: []
    })
});

// -------------------------------------------------- Continue in new chat --------------------------------------------------
const {
  bHandoffPending,
  continuedFrom,
  continuedInSessionId,
  continuedInSessionName,
  bHandoffSummaryOpen,
  onContinueInNewChat,
  openHandoffTarget,
  failHandoff,
  openContinuedSession,
  resetHandoff
} = useSessionHandoff({
  workspaceId: () => props.workspaceId,
  sessionId: () => props.sessionId,
  session,
  router,
  workspacesStore,
  toastStore,
  promptText,
  pendingImages
});

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
const {
  usageTurns,
  sessionCostLabel,
  sessionCostTitle,
  pooledRemainingLabel,
  fetchUsageTurns,
  loadPooledRemaining,
  resetUsage
} =
  useSessionUsage({
    workspaceId: () => props.workspaceId,
    sessionId: () => props.sessionId,
    session,
    streamingUsage,
    bIsStreaming
  });

const {
  workspaceName,
  workspacePath,
  subtitleWorkspaces,
  rulesSubtitleLabel,
  rulesSubtitleTitle,
  rulesSubtitleTo,
  headerCiState,
  headerCiTitle,
  sessionTagSuggestions,
  onSelectWorkspace,
  loadRulesCount
} = useSessionHeaderInfo({
  workspaceId: () => props.workspaceId,
  sessionId: () => props.sessionId,
  router,
  workspacesStore,
  bCiActive: () => activeTab.value !== 'git'
});

const sessionTerminalWsUrl = computed(() =>
  buildSessionTerminalWsUrl(props.workspaceId, props.sessionId)
);

const sessionTabs = computed(() => [
  { id: 'chat', label: 'Chat' },
  { id: 'plan', label: 'Plan', bVisible: bShowPlanTab.value },
  { id: 'orchestrator', label: 'Orchestrator', bVisible: !!plannedOrchestrator.value },
  { id: 'terminal', label: 'Terminal' },
  { id: 'files', label: 'Files' },
  { id: 'git', label: 'Git' }
]);

const { chatErrorActionLabel, handleChatErrorAction } = useChatErrorAction({
  chatErrorCode,
  lastPromptRequest: chatSocket.lastPromptRequest,
  retryLastPrompt: chatSocket.retryLastPrompt,
  modelSelection,
  router
});

// -------------------------------------------------- Methods --------------------------------------------------

/** "Fix failed build" from the Git tab: draft the prompt in the composer for review. */
function onFixBuild(prompt: string): void {
  const draft = promptText.value.trim();
  promptText.value = draft ? `${draft}\n\n${prompt}` : prompt;
  activeTab.value = 'chat';
  void nextTick(() => {
    composerRef.value?.resizeTextarea();
    composerRef.value?.focus();
  });
}

/** "Edit" on a sent message: put its text back into the composer (attachments are not restored). */
function onEditMessage(text: string): void {
  const draft = promptText.value;
  if (draft.trim() && draft !== text) {
    pendingEditText.value = text;
    return;
  }
  applyEditText(text);
}

function confirmReplaceDraft(): void {
  const text = pendingEditText.value;
  pendingEditText.value = null;
  if (text !== null) {
    applyEditText(text);
  }
}

function applyEditText(text: string): void {
  promptText.value = text;
  void nextTick(() => {
    composerRef.value?.resizeTextarea();
    composerRef.value?.focus();
  });
}

// ── Session edit/delete/archive ──────────────────────────────────────────────
const {
  bShowEditModal,
  bSavingEdit,
  bShowDeleteModal,
  bDeletingSession,
  bShowDeletePlanModal,
  bDeletingPlan,
  openEditModal,
  exportSessionMarkdown,
  saveSessionEdit,
  deleteSession,
  deleteSelectedPlan,
  toggleArchive,
  toggleFavorite
} = useSessionActions({
  workspaceId: () => props.workspaceId,
  sessionId: () => props.sessionId,
  session,
  messages,
  workspaceName: () => workspaceName.value,
  selectedPlanDocument,
  deletePlan: (plan) => planDocs.deletePlan(plan),
  router,
  workspacesStore,
  toastStore
});

// ── Session fetch ─────────────────────────────────────────────────────────────
const { bLoading, error, fetchSession } = useSessionLoader({
  workspaceId: () => props.workspaceId,
  sessionId: () => props.sessionId,
  session,
  bInitiallyLoading: !initialCache,
  bApiReachable,
  healthyPingCount,
  onSessionFetched: (fetched) => {
    agentOptions.applyFetchedSession(fetched);
    applySessionApprovalPolicy(fetched.approvalPolicy);
    void loadAgentOptions();
    void fetchUsageTurns();
  },
  onRetryLoaded: () => agentOptions.retryAgentOptionsIfFailed()
});

// -------------------------------------------------- Watchers --------------------------------------------------
// Re-selecting this chat in the sidebar drops `?tab=`; fall back to the chat tab.
watch(
  () => route.query.tab,
  (queryTab) => {
    const tab = tabFromQuery(queryTab) ?? 'chat';
    if (tab !== activeTab.value) activeTab.value = tab;
  }
);

watch(activeTab, (tab) => {
  syncSessionQuery();
  if (tab === 'chat') {
    chatSocket.ensureConnected();
    void nextTick(() => {
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
  () => props.workspaceId,
  () => {
    void loadRulesCount();
    loadPlannedOrchestrator();
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
    cancelSessionCachePersist();
    planDocs.resetPlanDocuments();
    // Close the old socket before reset so its late frames cannot land after clear.
    chatSocket.disconnect();
    chatSocket.resetChatState();
    resetUsage();
    collapseAllToolOutputs();
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
    resetHandoff();
    agentOptions.resetAgentOptions();
    applySessionApprovalPolicy(cached?.session?.approvalPolicy);
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
  const savedPrompt = readSessionPrompt(props.workspaceId, props.sessionId);
  if (savedPrompt != null) promptText.value = savedPrompt;

  // Fetch and socket run in parallel — the WS history frame must not wait on
  // the REST round-trip (a hung fetch would otherwise block chat + sending).
  void fetchSession();
  void loadPooledRemaining();
  chatSocket.connect();
  if (initialCache?.messages.length) {
    void nextTick(() => chatListRef.value?.forceInitialScrollToBottom());
  }
  await loadClaudeAutoContinueSetting();
  scheduleMermaidRender();
  applySessionQueryFromRoute();
});

onUnmounted(() => {
  flushSessionCache();
  planDocs.clearPlanDocumentsRefreshTimers();
  chatSocket.disconnect();
});
</script>

<template>
  <div ref="sessionChatRootRef" class="flex-1 flex flex-col overflow-hidden">
    <!-- Header -->
    <SessionChatHeader
      :session="session"
      :workspace-id="workspaceId"
      :workspace-name="workspaceName"
      :subtitle-workspaces="subtitleWorkspaces"
      :b-loading="bLoading"
      :b-show-sidebar-toggle="props.showSidebarToggle"
      :planned-orchestrator-id="plannedOrchestrator?.id ?? null"
      :b-plan-has-steps="bPlanHasSteps"
      :header-ci-state="headerCiState"
      :header-ci-title="headerCiTitle"
      :session-cost-label="sessionCostLabel"
      :session-cost-title="sessionCostTitle"
      :pooled-remaining-label="pooledRemainingLabel"
      :rules-subtitle-label="rulesSubtitleLabel"
      :rules-subtitle-title="rulesSubtitleTitle"
      :rules-subtitle-to="rulesSubtitleTo"
      @toggle-sidebar="emit('toggle-sidebar')"
      @new-session="emit('new-session')"
      @edit="openEditModal"
      @export="exportSessionMarkdown"
      @select-subtitle="onSelectWorkspace"
      @archive="toggleArchive"
      @delete="bShowDeleteModal = true"
      @toggle-favorite="toggleFavorite"
      @plan="planAsOrchestrator"
      @open-plan="activeTab = 'orchestrator'"
      @open-page="openOrchestratorPage"
      @open-git="activeTab = 'git'"
    />

    <div
      v-if="error"
      class="mx-4 md:mx-6 mt-4 flex items-center justify-between gap-3 border border-destructive/50 bg-destructive/10 text-destructive px-4 py-3 shrink-0"
    >
      <span>{{ error }}</span>
      <button
        type="button"
        class="shrink-0 rounded-md border border-destructive/50 bg-surface px-2 py-1 text-xs font-medium text-text-primary hover:bg-card disabled:opacity-50"
        :disabled="bLoading"
        @click="fetchSession()"
      >
        Retry
      </button>
    </div>

    <!-- Tab content -->
    <div class="flex-1 overflow-hidden flex flex-col min-h-0">
      <!-- Chat -->
      <div v-show="activeTab === 'chat'" class="flex-1 overflow-hidden flex flex-col min-h-0">
        <!-- Top region: message list (+ wide: right todo panel ending above the composer) -->
        <div
          class="flex-1 overflow-hidden flex min-h-0"
          :class="bWidePane ? 'flex-row' : 'flex-col'"
        >
          <div class="flex-1 min-w-0 flex flex-col min-h-0">
            <ChatHandoffBanner
              v-model:b-summary-open="bHandoffSummaryOpen"
              :continued-from="continuedFrom"
              :continued-in-session-id="continuedInSessionId"
              :continued-in-session-name="continuedInSessionName"
              @open-session="openContinuedSession"
            />
            <ChatMessageList
              ref="chatListRef"
              :b-active="activeTab === 'chat'"
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
              :send-approval-response="chatSocket.sendApprovalResponse"
              :send-question-response="chatSocket.sendQuestionResponse"
              @load-older="chatSocket.loadOlderMessages"
              @toggle-tool-output="toggleToolOutput"
              @open-plan="planDocs.openPlan"
              @open-file="openWorkspaceFile"
              @lightbox="(src) => (lightboxSrc = src)"
              @chat-error-action="handleChatErrorAction"
              @edit="onEditMessage"
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
          </div>

          <!-- Todo panel (wide: right column, ends above the composer) -->
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

        <!-- Connection indicator, todo reopen chip, background tasks -->
        <ChatStatusRows
          :b-ws-connected="bWsConnected"
          :b-ws-reconnecting="bWsReconnecting"
          :b-show-todo-chip="bAnyTodos && bTodoPanelClosed && bWidePane"
          :todo-done-count="todoDoneCount"
          :todo-count="todoItems.length"
          :busy-subagents="bIsStreaming ? liveBusySubagents : null"
          @open-todo-panel="openTodoPanel"
        />

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
          :b-can-continue-in-new-chat="messages.length > 0"
          :b-handoff-pending="bHandoffPending"
          :prompt-history="promptHistory"
          @send="onComposerSend"
          @continue-in-new-chat="onContinueInNewChat"
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

      <SessionPlanTab
        v-if="activeTab === 'plan'"
        :plan-documents="planDocuments"
        :selected-plan-document="selectedPlanDocument"
        @select="selectedPlanId = $event"
        @download="planDocs.downloadPlan"
        @refresh="() => planDocs.refreshPlanDocuments({ selectLatest: false })"
        @delete="bShowDeletePlanModal = true"
        @start-full-plan="planDocs.startSessionFromFullPlan"
        @start-plan-entry="({ plan, entry, index }) => planDocs.startSessionFromPlanEntry(plan, entry, index)"
        @mark-plan-entry-done="
          ({ plan, entry, index }) => planDocs.markPlanEntryDone(plan, entry, index)
        "
        @markdown-click="planDocs.onPlanMarkdownClick"
      />

      <OrchestratorPanel
        v-if="activeTab === 'orchestrator' && plannedOrchestrator"
        :workspace-id="workspaceId"
        :orchestrator-id="plannedOrchestrator.id"
        :orchestrator="plannedOrchestrator"
        b-embedded
        @update:orchestrator="orchestratorsStore.upsertOrchestrator"
        @open-chat="activeTab = 'chat'"
      />

      <!-- Terminal -->
      <div v-if="activeTab === 'terminal'" class="flex-1 min-h-0 p-2 md:p-4">
        <AppTerminal :ws-url="sessionTerminalWsUrl" />
      </div>

      <!-- Files -->
      <FilesView
        v-if="activeTab === 'files'"
        :key="sessionId"
        class="flex-1 min-h-0"
        :workspace-id="workspaceId"
        :active="activeTab === 'files'"
        :open-path="filesOpenPath"
        :reload-token="sessionId"
        @update:open-path="onFilesOpenPath"
      />

      <!-- Git -->
      <GitView
        v-if="activeTab === 'git'"
        :workspace-id="workspaceId"
        :active="activeTab === 'git'"
        :session-id="sessionId"
        @fix-build="onFixBuild"
      />
    </div>

    <!-- Bottom tabs -->
    <BottomTabBar
      :tabs="sessionTabs"
      :model-value="activeTab"
      @update:model-value="activeTab = $event as SessionTab"
    />

    <!-- Modals -->
    <SessionChatModals
      v-model:b-show-edit-modal="bShowEditModal"
      v-model:b-show-delete-modal="bShowDeleteModal"
      v-model:b-show-delete-plan-modal="bShowDeletePlanModal"
      :session="session"
      :b-saving-edit="bSavingEdit"
      :existing-tags="sessionTagSuggestions"
      :b-deleting-session="bDeletingSession"
      :selected-plan-document="selectedPlanDocument"
      :b-deleting-plan="bDeletingPlan"
      @save-session="saveSessionEdit"
      @delete-session="deleteSession"
      @delete-plan="deleteSelectedPlan"
    />

    <ImageLightbox v-model="lightboxSrc" />
    <ConfirmModal
      v-model="bShowReplaceDraftModal"
      title="Replace current draft?"
      description="Your unsent draft will be replaced by the selected message."
      confirm-label="Replace"
      variant="primary"
      @confirm="confirmReplaceDraft"
    />
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
