/**
 * Chat WebSocket + message state for a session.
 * Extracted from SessionChat.vue: owns the managed socket connection, history,
 * live streaming items, queue, and inline chat error state. UI concerns
 * (scroll, plan-tab switching, toasts) are surfaced via option callbacks.
 */

// node_modules
import { ref } from 'vue';

// classes
import { buildChatWsUrl, type AgentErrorCode } from '@/classes/api';
import { createManagedSocket, type ManagedSocket } from '@/lib/wsClient';
import { notifyTaskDone, notifyTodoCompleted } from '@/lib/notifications';

// utils
import {
  createChatStreamParser,
  indexSeenVibeIdsFromEvents,
  notificationPreviewFromStreamingItems,
  shouldSkipDuplicateVibeEventLine,
  type DisplayItem,
  type StreamUsage
} from '@/utils/chatDisplayItems';

// types
import type { ChatMessage, ChatQueueItem, ChatWsServerMessage } from '@/@types/index';

// -------------------------------------------------- Context --------------------------------------------------

export interface UseChatSocketContext {
  sessionId: () => string;
  workspaceId: () => string;
  /** Reconnect only while the chat tab is active (matches legacy behavior) */
  shouldBeConnected: () => boolean;
  isThinkingHidden: () => boolean;
  onModeUpdate: (modeId: string) => void;
  onModelUpdate: (modelId: string) => void;
  onConfigUpdate: (config: Record<string, string>) => void;
  /** A new plan item appeared in the live stream (id like `live-plan-N`) */
  onNewPlanItem: (planId: string) => void;
  /** History replaced / older page prepended / new content — UI scroll hooks */
  onHistoryLoaded: () => void;
  onHistoryPage: () => void;
  onContentAppended: () => void;
  onDone: () => void;
  sessionName: () => string;
  workspaceName: () => string;
  onClaudeLimitDetected: (resetTime: string, resetTimeReadable: string) => void;
}

export function useChatSocket(ctx: UseChatSocketContext) {
  // -------------------------------------------------- Refs --------------------------------------------------
  const messages = ref<ChatMessage[]>([]);
  const bIsStreaming = ref(false);
  const chatError = ref<string | null>(null);
  const chatErrorCode = ref<AgentErrorCode | null>(null);
  const streamingItems = ref<DisplayItem[]>([]);
  const streamingThinkingText = ref('');
  const streamingUsage = ref<StreamUsage | null>(null);
  const queuedPrompts = ref<ChatQueueItem[]>([]);
  const lastPromptRequest = ref<{ text: string; imagePaths: string[] } | null>(null);
  const bHasMore = ref(false);
  const bLoadingMore = ref(false);
  /** True once the first `history` frame for this session has arrived. */
  const bHistoryLoaded = ref(false);
  const bWsConnected = ref(false);
  const bWsReconnecting = ref(false);

  // Raw lines kept for DB persistence when the run ends.
  const streamingRawLines: string[] = [];
  const notifiedTodoIds = new Set<string>();
  const seenVibeMessageIds = new Set<string>();
  const seenVibeToolCallIds = new Set<string>();

  let socket: ManagedSocket | null = null;

  const parser = createChatStreamParser({
    thinkingText: streamingThinkingText,
    usage: streamingUsage,
    isThinkingHidden: ctx.isThinkingHidden,
    onModeUpdate: ctx.onModeUpdate,
    onModelUpdate: ctx.onModelUpdate,
    onConfigUpdate: ctx.onConfigUpdate
  });

  // -------------------------------------------------- Error helpers --------------------------------------------------

  function setChatError(message: string, code?: AgentErrorCode | null): void {
    chatError.value = message;
    chatErrorCode.value = code ?? null;
  }

  function clearChatError(): void {
    chatError.value = null;
    chatErrorCode.value = null;
  }

  // -------------------------------------------------- Frame handlers --------------------------------------------------

  function handleHistory(msg: ChatWsServerMessage): void {
    bHistoryLoaded.value = true;
    messages.value = msg.messages ?? [];
    seenVibeMessageIds.clear();
    seenVibeToolCallIds.clear();
    for (const m of messages.value) {
      indexSeenVibeIdsFromEvents(m.events, seenVibeMessageIds, seenVibeToolCallIds);
    }
    queuedPrompts.value = msg.queue ?? [];
    bHasMore.value = msg.hasMore ?? false;
    streamingItems.value = [];
    streamingRawLines.length = 0;
    streamingThinkingText.value = '';
    notifiedTodoIds.clear();
    bIsStreaming.value = msg.streaming === true;
    ctx.onHistoryLoaded();
  }

  function handleHistoryPage(msg: ChatWsServerMessage): void {
    const older = msg.messages ?? [];
    for (const m of older) {
      indexSeenVibeIdsFromEvents(m.events, seenVibeMessageIds, seenVibeToolCallIds);
    }
    messages.value = [...older, ...messages.value];
    bHasMore.value = msg.hasMore ?? false;
    bLoadingMore.value = false;
    ctx.onHistoryPage();
  }

  function handlePromptStarted(msg: ChatWsServerMessage): void {
    const prompt = msg.prompt;
    if (!prompt) return;
    lastPromptRequest.value = {
      text: prompt.text,
      imagePaths: prompt.imagePaths ?? []
    };
    messages.value.push({
      role: 'user',
      content: prompt.text,
      imagePaths: prompt.imagePaths?.length ? prompt.imagePaths : undefined,
      createdAt: prompt.createdAt
    });
    ctx.onContentAppended();
  }

  function handleStream(msg: ChatWsServerMessage): void {
    bIsStreaming.value = true;
    const line = msg.data ?? '';
    const controlMessage = parseControlStreamMessage(line);
    if (controlMessage?.type === 'claude_limit_detected') {
      ctx.onClaudeLimitDetected(
        controlMessage.resetTime ?? new Date().toISOString(),
        controlMessage.resetTimeReadable ?? 'unknown time'
      );
    }
    if (shouldSkipDuplicateVibeEventLine(line, seenVibeMessageIds, seenVibeToolCallIds)) return;
    const previousPlanCount = streamingItems.value.filter((item) => item.kind === 'plan').length;
    streamingRawLines.push(line);
    parser.processEventLine(line, streamingItems.value, { liveThinking: true });
    const nextPlanCount = streamingItems.value.filter((item) => item.kind === 'plan').length;
    if (nextPlanCount > previousPlanCount) {
      ctx.onNewPlanItem(`live-plan-${nextPlanCount - 1}`);
    }
    for (const item of streamingItems.value) {
      if (item.kind !== 'todos' || !item.todoItems) continue;
      for (const t of item.todoItems) {
        if (t.status === 'TODO_STATUS_COMPLETED' && !notifiedTodoIds.has(t.id)) {
          notifiedTodoIds.add(t.id);
          notifyTodoCompleted(t.content);
        }
      }
    }
    ctx.onContentAppended();
  }

  function handleDone(): void {
    const lastAssistantMessage = notificationPreviewFromStreamingItems(streamingItems.value);
    const events = [...streamingRawLines];
    messages.value.push({
      role: 'assistant',
      events,
      content: events.length === 0 ? '(No response from agent)' : undefined,
      createdAt: new Date().toISOString()
    });
    streamingItems.value = [];
    streamingRawLines.length = 0;
    streamingThinkingText.value = '';
    streamingUsage.value = null;
    notifiedTodoIds.clear();
    bIsStreaming.value = false;
    ctx.onDone();
    ctx.onContentAppended();
    notifyTaskDone(
      ctx.sessionName(),
      ctx.workspaceName(),
      lastAssistantMessage,
      ctx.workspaceId(),
      ctx.sessionId()
    );
  }

  function handleError(msg: ChatWsServerMessage): void {
    setChatError(msg.message ?? 'Unknown error', msg.code ?? null);
    streamingItems.value = [];
    streamingRawLines.length = 0;
    streamingThinkingText.value = '';
    streamingUsage.value = null;
    notifiedTodoIds.clear();
    bIsStreaming.value = false;
  }

  function parseControlStreamMessage(
    line: string
  ): { type?: string; resetTime?: string; resetTimeReadable?: string } | null {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        resetTime?: string;
        resetTimeReadable?: string;
      };
      if (!parsed?.type || typeof parsed.type !== 'string') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function onSocketMessage(data: string): void {
    try {
      const msg = JSON.parse(data) as ChatWsServerMessage;
      if (msg.type === 'history') {
        handleHistory(msg);
      } else if (msg.type === 'history-page') {
        handleHistoryPage(msg);
      } else if (msg.type === 'queue-updated') {
        queuedPrompts.value = msg.queue ?? [];
      } else if (msg.type === 'prompt-started') {
        handlePromptStarted(msg);
      } else if (msg.type === 'stream') {
        handleStream(msg);
      } else if (msg.type === 'done') {
        handleDone();
      } else if (msg.type === 'error') {
        handleError(msg);
      } else if (msg.type === 'server-shutdown') {
        setChatError('Server disconnected');
        streamingThinkingText.value = '';
        bIsStreaming.value = false;
      } else if (msg.type === 'claude_limit_detected') {
        ctx.onClaudeLimitDetected(
          msg.resetTime ?? new Date().toISOString(),
          msg.resetTimeReadable ?? 'unknown time'
        );
      }
    } catch {
      // ignore malformed frames
    }
  }

  // -------------------------------------------------- Connection --------------------------------------------------

  function connect(): void {
    if (socket) {
      return;
    }
    socket = createManagedSocket({
      url: buildChatWsUrl(ctx.sessionId()),
      shouldBeConnected: ctx.shouldBeConnected,
      onMessage: onSocketMessage,
      onConnectionChange: (bConnected) => {
        bWsConnected.value = bConnected;
        if (bConnected) {
          bWsReconnecting.value = false;
        } else if (ctx.shouldBeConnected()) {
          bWsReconnecting.value = true;
        }
      },
      onUnauthorized: () => {
        setChatError('Connection closed (auth)');
      }
    });
  }

  /** Recreate the socket when returning to the chat tab after a drop. */
  function ensureConnected(): void {
    if (socket && socket.bConnected) {
      return;
    }
    if (socket) {
      socket.close();
      socket = null;
    }
    clearChatError();
    connect();
  }

  function disconnect(): void {
    socket?.close();
    socket = null;
    bWsConnected.value = false;
    bWsReconnecting.value = false;
  }

  // -------------------------------------------------- Outgoing --------------------------------------------------

  function sendPrompt(payload: {
    text: string;
    model: string;
    mode: string;
    imagePaths: string[];
  }): boolean {
    if (!socket || !bWsConnected.value) {
      return false;
    }
    clearChatError();
    lastPromptRequest.value = { text: payload.text, imagePaths: payload.imagePaths };
    socket.send({
      type: 'prompt',
      text: payload.text,
      model: payload.model,
      mode: payload.mode,
      imagePaths: payload.imagePaths
    });
    return true;
  }

  function retryLastPrompt(model: string): void {
    if (!lastPromptRequest.value || !socket || !bWsConnected.value) return;
    clearChatError();
    socket.send({
      type: 'prompt',
      text: lastPromptRequest.value.text,
      model,
      imagePaths: lastPromptRequest.value.imagePaths
    });
  }

  function cancelPrompt(): void {
    if (!bIsStreaming.value || !socket || !bWsConnected.value) return;
    socket.send({ type: 'cancel' });
  }

  function deleteQueuedPrompt(queueItemId: string): void {
    socket?.send({ type: 'queue-delete', queueItemId });
  }

  function pushQueuedPrompt(queueItemId: string): void {
    socket?.send({ type: 'queue-push', queueItemId });
  }

  function loadOlderMessages(): void {
    if (!socket || !bWsConnected.value) return;
    bLoadingMore.value = true;
    socket.send({ type: 'load-more', offset: messages.value.length });
  }

  /** Reset everything (session switch / unmount). */
  function resetChatState(): void {
    bHistoryLoaded.value = false;
    messages.value = [];
    seenVibeMessageIds.clear();
    seenVibeToolCallIds.clear();
    streamingItems.value = [];
    streamingRawLines.length = 0;
    streamingThinkingText.value = '';
    streamingUsage.value = null;
    notifiedTodoIds.clear();
    queuedPrompts.value = [];
    bHasMore.value = false;
    bLoadingMore.value = false;
    clearChatError();
  }

  // -------------------------------------------------- Export --------------------------------------------------
  return {
    // data
    messages,
    bIsStreaming,
    chatError,
    chatErrorCode,
    streamingItems,
    streamingThinkingText,
    streamingUsage,
    queuedPrompts,
    lastPromptRequest,
    bHasMore,
    bLoadingMore,
    bHistoryLoaded,
    bWsConnected,
    bWsReconnecting,
    // methods
    setChatError,
    clearChatError,
    connect,
    ensureConnected,
    disconnect,
    sendPrompt,
    retryLastPrompt,
    cancelPrompt,
    deleteQueuedPrompt,
    pushQueuedPrompt,
    loadOlderMessages,
    resetChatState
  };
}

export type UseChatSocket = ReturnType<typeof useChatSocket>;
