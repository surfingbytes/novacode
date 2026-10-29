// @vitest-environment jsdom

// node_modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, onUnmounted } from 'vue';
import { mount } from '@vue/test-utils';

// composables
import { useChatSocket, type UseChatSocketContext } from '@/composables/useChatSocket';

// test helpers
import { FakeWebSocket, liveFakeSockets } from '@/test/fakeWebSocket';

// types
import type { ChatApprovalRequest, ChatMessage, ChatQuestionRequest } from '@/@types/index';

vi.mock('@/lib/notifications', () => ({ notifyTaskDone: vi.fn() }));

// -------------------------------------------------- Helpers --------------------------------------------------

function makeCtx(overrides: Partial<UseChatSocketContext> = {}): UseChatSocketContext {
  return {
    sessionId: () => 's1',
    workspaceId: () => 'w1',
    shouldBeConnected: () => true,
    isThinkingHidden: () => false,
    onModeUpdate: vi.fn(),
    onModelUpdate: vi.fn(),
    onConfigUpdate: vi.fn(),
    onNewPlanItem: vi.fn(),
    onPlanApprovalRequested: vi.fn(),
    onHistoryLoaded: vi.fn(),
    onHistoryPage: vi.fn(),
    onContentAppended: vi.fn(),
    onDone: vi.fn(),
    onMessagesChanged: vi.fn(),
    sessionName: () => 'Session',
    workspaceName: () => 'Workspace',
    onClaudeLimitDetected: vi.fn(),
    ...overrides
  };
}

const frame = (payload: Record<string, unknown>): string => JSON.stringify(payload);

const streamFrame = (update: Record<string, unknown>): string =>
  frame({ type: 'stream', data: JSON.stringify({ sessionId: 's1', update }) });

const textChunk = (text: string): string =>
  streamFrame({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });

const userMsg = (content: string): ChatMessage => ({
  role: 'user',
  content,
  createdAt: '2026-01-01T00:00:00.000Z'
});

const approval = (id: string, extra: Partial<ChatApprovalRequest> = {}): ChatApprovalRequest => ({
  id,
  sessionId: 's1',
  title: 'Run command',
  options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
  ...extra
});

const question = (id: string): ChatQuestionRequest => ({
  id,
  sessionId: 's1',
  toolCallId: 'tq',
  questions: [{ id: 'q1', prompt: 'Pick one', options: [{ id: 'a', label: 'A' }] }]
});

/** Connects and opens the socket; returns the chat state and the fake server socket. */
function connectOpen(overrides: Partial<UseChatSocketContext> = {}) {
  const ctx = makeCtx(overrides);
  const chat = useChatSocket(ctx);
  chat.connect();
  const ws = FakeWebSocket.instances.at(-1)!;
  ws.serverOpen();
  return { chat, ctx, ws };
}

let cleanup: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  // Jitter = backoff × (0.75 + random × 0.5) → exactly the backoff.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// -------------------------------------------------- Tests --------------------------------------------------

describe('useChatSocket', () => {
  it('connects to the session chat URL and applies the history frame', () => {
    const { chat, ctx, ws } = connectOpen();
    cleanup = chat.disconnect;

    expect(ws.url).toMatch(/\/ws\/chat\/s1$/);
    expect(chat.bWsConnected.value).toBe(true);
    expect(chat.bHistoryLoaded.value).toBe(false);

    ws.serverMessage(
      frame({ type: 'history', messages: [userMsg('hi')], hasMore: true, queue: [], streaming: false })
    );

    expect(chat.messages.value.map((m) => m.content)).toEqual(['hi']);
    expect(chat.bHasMore.value).toBe(true);
    expect(chat.bHistoryLoaded.value).toBe(true);
    expect(chat.bIsStreaming.value).toBe(false);
    expect(ctx.onHistoryLoaded).toHaveBeenCalledTimes(1);
    expect(ctx.onMessagesChanged).toHaveBeenCalledTimes(1);
  });

  it('marks the chat busy when history reports an in-flight run', () => {
    const { chat, ws } = connectOpen();
    cleanup = chat.disconnect;

    ws.serverMessage(frame({ type: 'history', messages: [userMsg('hi')], streaming: true }));

    expect(chat.bIsStreaming.value).toBe(true);
  });

  it('keeps an optimistic turn when a stale empty history frame arrives', () => {
    const { chat, ws } = connectOpen();
    cleanup = chat.disconnect;

    expect(chat.sendPrompt({ text: 'go', model: 'auto', mode: 'agent', imagePaths: [] })).toBe(true);
    ws.serverMessage(frame({ type: 'history', messages: [], streaming: true }));

    expect(chat.messages.value.map((m) => m.content)).toEqual(['go']);
    expect(chat.bIsStreaming.value).toBe(true);
  });

  it('appends streamed text deltas in order into one item', () => {
    const { chat, ctx, ws } = connectOpen();
    cleanup = chat.disconnect;
    ws.serverMessage(frame({ type: 'history', messages: [] }));

    ws.serverMessage(textChunk('Hello'));
    ws.serverMessage(textChunk(', '));
    ws.serverMessage(textChunk('world'));

    expect(chat.bIsStreaming.value).toBe(true);
    expect(chat.streamingItems.value).toHaveLength(1);
    expect(chat.streamingItems.value[0]?.text).toBe('Hello, world');
    expect(ctx.onContentAppended).toHaveBeenCalledTimes(3);
  });

  it('tracks tool-call start, update and end as one tool item', () => {
    const { chat, ws } = connectOpen();
    cleanup = chat.disconnect;

    ws.serverMessage(
      streamFrame({ sessionUpdate: 'tool_call', toolCallId: 't1', kind: 'execute', title: 'ls' })
    );
    expect(chat.streamingItems.value).toHaveLength(1);
    expect(chat.streamingItems.value[0]?.kind).toBe('tool');
    expect(chat.streamingItems.value[0]?.status).not.toBe('success');

    ws.serverMessage(
      streamFrame({
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        status: 'in_progress',
        content: [{ type: 'content', content: { type: 'text', text: 'partial' } }]
      })
    );
    ws.serverMessage(
      streamFrame({
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'a.ts' } }]
      })
    );

    expect(chat.streamingItems.value).toHaveLength(1);
    expect(chat.streamingItems.value[0]?.status).toBe('success');
    expect(chat.streamingItems.value[0]?.toolOutput).toBe('a.ts');
  });

  it('goes busy on prompt-started and idle on done, persisting the streamed turn', () => {
    const { chat, ctx, ws } = connectOpen();
    cleanup = chat.disconnect;
    ws.serverMessage(frame({ type: 'history', messages: [] }));

    ws.serverMessage(
      frame({ type: 'prompt-started', prompt: { text: 'q', createdAt: '2026-01-01T00:00:01.000Z' } })
    );
    expect(chat.bIsStreaming.value).toBe(true);
    expect(chat.lastPromptRequest.value).toEqual({ text: 'q', imagePaths: [] });

    ws.serverMessage(textChunk('answer'));
    ws.serverMessage(frame({ type: 'done' }));

    expect(chat.bIsStreaming.value).toBe(false);
    expect(chat.streamingItems.value).toEqual([]);
    expect(chat.messages.value.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(chat.messages.value[1]?.events).toHaveLength(1);
    expect(ctx.onDone).toHaveBeenCalledTimes(1);
  });

  it('reuses the optimistic user turn when prompt-started echoes it', () => {
    const { chat, ws } = connectOpen();
    cleanup = chat.disconnect;

    chat.sendPrompt({ text: 'go', model: 'auto', mode: 'agent', imagePaths: [] });
    ws.serverMessage(
      frame({ type: 'prompt-started', prompt: { text: 'go', createdAt: '2026-01-01T00:00:02.000Z' } })
    );

    expect(chat.messages.value).toHaveLength(1);
    expect(chat.messages.value[0]?.createdAt).toBe('2026-01-01T00:00:02.000Z');
    expect(JSON.parse(ws.sent[0])).toMatchObject({ type: 'prompt', text: 'go', model: 'auto' });
  });

  it('goes idle and surfaces the error on an error frame', () => {
    const { chat, ws } = connectOpen();
    cleanup = chat.disconnect;
    ws.serverMessage(textChunk('partial'));

    ws.serverMessage(frame({ type: 'error', message: 'Rate limited', code: 'rate_limited' }));

    expect(chat.bIsStreaming.value).toBe(false);
    expect(chat.streamingItems.value).toEqual([]);
    expect(chat.chatError.value).toBe('Rate limited');
    expect(chat.chatErrorCode.value).toBe('rate_limited');
  });

  it('exposes approval requests until resolved and sends the response', () => {
    const { chat, ws } = connectOpen();
    cleanup = chat.disconnect;

    ws.serverMessage(frame({ type: 'approval-requested', approval: approval('a1') }));
    ws.serverMessage(frame({ type: 'approval-requested', approval: approval('a2') }));
    // Re-sent request replaces rather than duplicates.
    ws.serverMessage(frame({ type: 'approval-requested', approval: approval('a1', { title: 'v2' }) }));
    expect(chat.pendingApprovals.value.map((a) => [a.id, a.title])).toEqual([
      ['a2', 'Run command'],
      ['a1', 'v2']
    ]);

    expect(chat.sendApprovalResponse('a1', 'allow')).toBe(true);
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({
      type: 'approval-response',
      approvalRequestId: 'a1',
      approvalOptionId: 'allow'
    });

    ws.serverMessage(frame({ type: 'approval-resolved', approvalRequestId: 'a1' }));
    expect(chat.pendingApprovals.value.map((a) => a.id)).toEqual(['a2']);
  });

  it('turns a plan approval into a live plan item and notifies the UI', () => {
    const { chat, ctx, ws } = connectOpen();
    cleanup = chat.disconnect;

    ws.serverMessage(
      frame({
        type: 'approval-requested',
        approval: approval('p1', { title: 'Approve plan', planMarkdown: '# Plan\n\n- step' })
      })
    );

    const plan = chat.streamingItems.value.find((item) => item.kind === 'plan');
    expect(plan?.planId).toBe('live-plan-0');
    expect(plan?.planMarkdown).toBe('# Plan\n\n- step');
    expect(ctx.onPlanApprovalRequested).toHaveBeenCalledTimes(1);
  });

  it('exposes question requests until resolved and sends answers or skips', () => {
    const { chat, ws } = connectOpen();
    cleanup = chat.disconnect;

    ws.serverMessage(frame({ type: 'question-requested', question: question('q1') }));
    expect(chat.pendingQuestions.value.map((q) => q.id)).toEqual(['q1']);

    chat.sendQuestionResponse('q1', { answers: [{ questionId: 'q1', selectedOptionIds: ['a'] }] });
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({
      type: 'question-response',
      questionRequestId: 'q1',
      questionAnswers: [{ questionId: 'q1', selectedOptionIds: ['a'] }]
    });
    chat.sendQuestionResponse('q1', { skipped: true });
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({
      type: 'question-response',
      questionRequestId: 'q1',
      questionSkipped: true
    });

    ws.serverMessage(frame({ type: 'question-resolved', questionRequestId: 'q1' }));
    expect(chat.pendingQuestions.value).toEqual([]);
  });

  it('refuses outgoing responses while disconnected', () => {
    const chat = useChatSocket(makeCtx());
    chat.connect();
    cleanup = chat.disconnect;

    expect(chat.sendPrompt({ text: 'x', model: 'auto', mode: 'agent', imagePaths: [] })).toBe(false);
    expect(chat.sendApprovalResponse('a1', 'allow')).toBe(false);
    expect(chat.sendQuestionResponse('q1', { skipped: true })).toBe(false);
    expect(chat.messages.value).toEqual([]);
  });

  it('reconnects to the same session after a drop and takes the fresh history', () => {
    const { chat, ws } = connectOpen();
    cleanup = chat.disconnect;
    ws.serverMessage(frame({ type: 'history', messages: [userMsg('old')] }));

    ws.serverClose(1006);
    expect(chat.bWsConnected.value).toBe(false);
    expect(chat.bWsReconnecting.value).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const next = FakeWebSocket.instances[1];
    expect(next.url).toBe(ws.url);

    next.serverOpen();
    expect(chat.bWsConnected.value).toBe(true);
    expect(chat.bWsReconnecting.value).toBe(false);

    next.serverMessage(frame({ type: 'history', messages: [userMsg('old'), userMsg('new')] }));
    expect(chat.messages.value.map((m) => m.content)).toEqual(['old', 'new']);
  });

  it('does not reconnect while the chat tab is inactive', () => {
    let bActive = true;
    const { chat, ws } = connectOpen({ shouldBeConnected: () => bActive });
    cleanup = chat.disconnect;

    bActive = false;
    ws.serverClose(1006);
    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(chat.bWsReconnecting.value).toBe(false);
  });

  it('ensureConnected replaces a dropped socket and ignores its late frames', () => {
    const { chat, ws } = connectOpen();
    cleanup = chat.disconnect;
    ws.serverClose(1006);

    chat.ensureConnected();
    expect(FakeWebSocket.instances).toHaveLength(2);

    // The replaced socket's handlers are detached by the managed client.
    ws.serverMessage(frame({ type: 'history', messages: [userMsg('stale')] }));
    expect(chat.messages.value).toEqual([]);
  });

  it('closes the socket and removes window listeners on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const docAddSpy = vi.spyOn(document, 'addEventListener');
    const docRemoveSpy = vi.spyOn(document, 'removeEventListener');
    let chat: ReturnType<typeof useChatSocket> | null = null;

    const Host = defineComponent({
      setup() {
        chat = useChatSocket(makeCtx());
        chat.connect();
        onUnmounted(() => chat?.disconnect());
        return () => h('div');
      }
    });
    const wrapper = mount(Host);
    const ws = FakeWebSocket.instances[0];
    ws.serverOpen();

    wrapper.unmount();

    expect(ws.readyState).toBe(FakeWebSocket.CLOSING);
    expect(liveFakeSockets()).toEqual([]);
    expect(chat!.bWsConnected.value).toBe(false);

    const added = (spy: typeof addSpy | typeof docAddSpy, type: string) =>
      spy.mock.calls.filter(([t]) => t === type).map(([, fn]) => fn);
    expect(added(removeSpy, 'online')).toEqual(added(addSpy, 'online'));
    expect(added(docRemoveSpy, 'visibilitychange')).toEqual(added(docAddSpy, 'visibilitychange'));

    // Nothing wakes the client up again and late frames are dropped.
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(60_000);
    ws.serverMessage(frame({ type: 'history', messages: [userMsg('late')] }));
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(chat!.messages.value).toEqual([]);
  });
});
