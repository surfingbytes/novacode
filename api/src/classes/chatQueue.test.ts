// node_modules
import { beforeEach, describe, expect, it, vi } from 'vitest';

// types
import type { ChatQueueItem } from '../@types/index';
import type { ChatSubscriber } from './chatEngine';

const { state, dbMock, engine, broadcastChat } = vi.hoisted(() => {
  const state = {
    queue: [] as ChatQueueItem[],
    nextId: 1,
    activeSessions: new Set<string>(),
    dispatched: [] as { text: string; subscriber: ChatSubscriber }[],
    dispatchResult: null as null | { error?: string; requeue?: boolean }
  };
  const dbMock = {
    listSessionQueue: vi.fn(async (sessionId: string) => state.queue.filter((item) => item.sessionId === sessionId)),
    enqueueSessionQueueItem: vi.fn(
      async (data: { sessionId: string; text: string; model: string; mode: string; imagePaths?: string[] }) => {
        const item = {
          id: `q${state.nextId++}`,
          sessionId: data.sessionId,
          text: data.text,
          model: data.model,
          mode: data.mode,
          imagePaths: data.imagePaths ?? [],
          createdAt: new Date().toISOString()
        } as unknown as ChatQueueItem;
        state.queue.push(item);
        return item;
      }
    ),
    dequeueNextSessionQueueItem: vi.fn(async (sessionId: string) => {
      const index = state.queue.findIndex((item) => item.sessionId === sessionId);
      return index === -1 ? undefined : state.queue.splice(index, 1)[0];
    }),
    deleteSessionQueueItem: vi.fn(),
    updateSessionQueueItemText: vi.fn(),
    moveSessionQueueItemToFront: vi.fn(),
    getSession: vi.fn()
  };
  const engine = {
    getActiveRun: vi.fn((sessionId: string) => (state.activeSessions.has(sessionId) ? {} : undefined)),
    cancelRun: vi.fn(),
    dispatchPromptAndWait: vi.fn(),
    dispatchPrompt: vi.fn(async (opts: { sessionId: string; text: string; subscriber: ChatSubscriber }) => {
      if (state.dispatchResult) return state.dispatchResult;
      state.activeSessions.add(opts.sessionId);
      state.dispatched.push({ text: opts.text, subscriber: opts.subscriber });
      return {};
    })
  };
  return { state, dbMock, engine, broadcastChat: vi.fn() };
});

vi.mock('./database', () => ({ db: dbMock }));
vi.mock('./chatEngine', () => engine);
vi.mock('./chatSockets', () => ({ broadcastChat }));
vi.mock('./sessionTitle', () => ({ maybeNameUntitledSessionFromAssistant: vi.fn(async () => {}) }));

// classes
import { drainQueue, enqueuePrompt } from './chatQueue';

const SESSION = 's1';

function enqueue(text: string): Promise<ChatQueueItem> {
  return enqueuePrompt({ sessionId: SESSION, text, model: 'auto', mode: 'default', imagePaths: [] });
}

/** End the active run the way chatEngine does: clear it, then notify the subscriber. */
function finishRun(index: number, outcome: 'done' | 'error'): void {
  state.activeSessions.delete(SESSION);
  const { subscriber } = state.dispatched[index]!;
  if (outcome === 'done') subscriber.onDone([]);
  else subscriber.onError('boom');
}

const dispatchedTexts = (): string[] => state.dispatched.map((entry) => entry.text);

beforeEach(() => {
  vi.clearAllMocks();
  state.queue = [];
  state.nextId = 1;
  state.activeSessions.clear();
  state.dispatched = [];
  state.dispatchResult = null;
});

describe('chatQueue', () => {
  it('runs prompts one at a time in enqueue order', async () => {
    await enqueue('first');
    await enqueue('second');
    await enqueue('third');

    await drainQueue(SESSION);
    expect(dispatchedTexts()).toEqual(['first']);

    // A second drain while the run is active must not start another prompt.
    await drainQueue(SESSION);
    expect(dispatchedTexts()).toEqual(['first']);

    finishRun(0, 'done');
    await vi.waitFor(() => expect(dispatchedTexts()).toEqual(['first', 'second']));
    finishRun(1, 'done');
    await vi.waitFor(() => expect(dispatchedTexts()).toEqual(['first', 'second', 'third']));
  });

  it('drains to an empty queue and then idles', async () => {
    await enqueue('only');
    await drainQueue(SESSION);
    finishRun(0, 'done');

    await vi.waitFor(() =>
      expect(broadcastChat).toHaveBeenLastCalledWith(SESSION, { type: 'queue-updated', queue: [] })
    );
    expect(state.queue).toEqual([]);
    await drainQueue(SESSION);
    expect(dispatchedTexts()).toEqual(['only']);
  });

  it('dispatches only once for concurrent drains', async () => {
    await enqueue('a');
    await enqueue('b');
    await Promise.all([drainQueue(SESSION), drainQueue(SESSION), drainQueue(SESSION)]);
    expect(dispatchedTexts()).toEqual(['a']);
  });

  it('a prompt whose run fails does not block the next one', async () => {
    await enqueue('fails');
    await enqueue('next');
    await drainQueue(SESSION);

    finishRun(0, 'error');
    await vi.waitFor(() => expect(dispatchedTexts()).toEqual(['fails', 'next']));
  });

  it('a prompt that cannot start is dropped or requeued and the next one still runs', async () => {
    await enqueue('bad path');
    await enqueue('good');

    // Permanent failure: user message not persisted, item is not put back.
    state.dispatchResult = { error: 'Invalid workspace path', requeue: false };
    await drainQueue(SESSION);
    expect(broadcastChat).toHaveBeenCalledWith(SESSION, {
      type: 'error',
      message: 'Invalid workspace path',
      code: undefined
    });
    expect(state.queue.map((item) => item.text)).toEqual(['good']);

    // Retryable failure: item goes back to the end of the queue.
    state.dispatchResult = { error: 'Agent is busy', requeue: true };
    await drainQueue(SESSION);
    expect(state.queue.map((item) => item.text)).toEqual(['good']);

    state.dispatchResult = null;
    await drainQueue(SESSION);
    expect(dispatchedTexts()).toEqual(['good']);
  });
});
