// classes
import { db } from './database';
import { cancelRun, dispatchPrompt, dispatchPromptAndWait, getActiveRun, type ChatSubscriber } from './chatEngine';
import { broadcastChat } from './chatSockets';
import { maybeNameUntitledSessionFromAssistant } from './sessionTitle';

// types
import type { ChatMessage, ChatQueueItem } from '../@types/index';

export interface QueuedPromptInput {
  sessionId: string;
  text: string;
  model: string;
  mode: string;
  imagePaths: string[];
}

/** Sessions whose queue worker is dequeuing / dispatching right now. */
const queueWorkers = new Set<string>();

export async function loadQueue(sessionId: string): Promise<ChatQueueItem[]> {
  return db.listSessionQueue(sessionId);
}

/** Push the session's current queue to its open chat sockets. */
export async function broadcastQueueUpdate(sessionId: string): Promise<void> {
  const queue = await loadQueue(sessionId);
  broadcastChat(sessionId, { type: 'queue-updated', queue });
}

/** Persist a prompt at the end of the session's queue. Does not start it; call drainQueue. */
export async function enqueuePrompt(input: QueuedPromptInput): Promise<ChatQueueItem> {
  return db.enqueueSessionQueueItem(input);
}

export async function deleteQueueItem(sessionId: string, queueItemId: string): Promise<void> {
  await db.deleteSessionQueueItem(sessionId, queueItemId);
  await broadcastQueueUpdate(sessionId);
}

export async function editQueueItem(sessionId: string, queueItemId: string, text: string): Promise<void> {
  await db.updateSessionQueueItemText(sessionId, queueItemId, text.trim());
  await broadcastQueueUpdate(sessionId);
}

/** Move a queued prompt to the front and cancel the active run so it starts next. */
export async function pushQueueItemToFront(sessionId: string, queueItemId: string): Promise<void> {
  const moved = await db.moveSessionQueueItemToFront(sessionId, queueItemId);
  if (moved) {
    cancelRun(sessionId);
  }
  await broadcastQueueUpdate(sessionId);
  await drainQueue(sessionId);
}

/**
 * Start the next queued prompt when the session is idle. The run's onDone /
 * onError call this again, so the queue drains one prompt at a time.
 */
export async function drainQueue(sessionId: string): Promise<void> {
  if (queueWorkers.has(sessionId)) {
    return;
  }
  queueWorkers.add(sessionId);
  try {
    if (getActiveRun(sessionId)) {
      return;
    }
    const next = await db.dequeueNextSessionQueueItem(sessionId);
    if (!next) {
      await broadcastQueueUpdate(sessionId);
      return;
    }
    await broadcastQueueUpdate(sessionId);
    broadcastChat(sessionId, {
      type: 'prompt-started',
      queueItemId: next.id,
      prompt: {
        text: next.text,
        imagePaths: next.imagePaths,
        createdAt: next.createdAt
      }
    });
    const sub: ChatSubscriber = {
      // Stream/done/error delivery to chat sockets is handled by the run's
      // session-broadcast subscriber (installChatRunBroadcast);
      // this subscriber only sequences the queue.
      onStream: () => {},
      onDone: (messages) => {
        void broadcastQueueUpdate(sessionId);
        void maybeNameUntitledSessionFromAssistant(sessionId, messages);
        void drainQueue(sessionId);
      },
      onError: () => {
        void broadcastQueueUpdate(sessionId);
        void drainQueue(sessionId);
      },
      onHistory: () => {}
    };
    const result = await dispatchPrompt({
      sessionId,
      text: next.text,
      model: next.model,
      mode: next.mode,
      imagePaths: next.imagePaths,
      subscriber: sub
    });
    if (result.error) {
      // Queue item was already removed. Put it back when the user message was not
      // persisted, otherwise the prompt vanishes while session title naming still runs.
      if (result.requeue !== false) {
        await db.enqueueSessionQueueItem({
          sessionId,
          text: next.text,
          model: next.model,
          mode: next.mode,
          imagePaths: next.imagePaths
        });
        await broadcastQueueUpdate(sessionId);
      }
      broadcastChat(sessionId, { type: 'error', message: result.error, code: result.errorCode });
      // Do not immediately retry: permanent errors would loop, and "Agent is busy"
      // is drained when the active run's onDone calls drainQueue.
    }
  } finally {
    queueWorkers.delete(sessionId);
  }
}

/**
 * Run a server-initiated prompt as a normal turn of the session (same agent,
 * model and conversation) and wait for it. Open chats see it like a sent message.
 * Prompts the user queued meanwhile run afterwards.
 */
export async function runServerPromptInSession(opts: {
  sessionId: string;
  text: string;
  timeoutMs?: number;
}): Promise<{ error?: string; messages?: ChatMessage[] }> {
  const { sessionId, text } = opts;
  if (getActiveRun(sessionId)) {
    return { error: 'Agent is busy' };
  }
  const session = await db.getSession(sessionId);
  if (!session) {
    return { error: 'Session not found' };
  }
  broadcastChat(sessionId, {
    type: 'prompt-started',
    prompt: { text, createdAt: new Date().toISOString() }
  });
  const result = await dispatchPromptAndWait({
    sessionId,
    text,
    model: session.modelSelection,
    mode: session.sessionMode,
    timeoutMs: opts.timeoutMs
  });
  void drainQueue(sessionId);
  return result;
}
