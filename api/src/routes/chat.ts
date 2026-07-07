// node_modules
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

// classes
import { verifyToken } from '../classes/auth';
import { db } from '../classes/database';
import {
  getActiveSessionIds as _getActiveSessionIds,
  getActiveRun,
  cancelRun,
  dispatchPrompt,
  type ChatSubscriber
} from '../classes/chatEngine';

// types
import type {
  ChatMessage,
  ChatQueueItem,
  ChatWsClientMessage,
  ChatWsServerMessage
} from '../@types/index';

export function getActiveSessionIds(): Set<string> {
  return _getActiveSessionIds();
}

export { cancelRun };

const HISTORY_PAGE_SIZE = 50;
const chatSessionClients = new Map<string, Set<WebSocket>>();
const queueWorkers = new Set<string>();

// ---------------------------------- Socket Helpers ----------------------------------
function send(socket: WebSocket, message: ChatWsServerMessage): void {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

function registerChatSocket(sessionId: string, socket: WebSocket): void {
  let socketSet = chatSessionClients.get(sessionId);
  if (!socketSet) {
    socketSet = new Set<WebSocket>();
    chatSessionClients.set(sessionId, socketSet);
  }
  socketSet.add(socket);
}

function unregisterChatSocket(sessionId: string, socket: WebSocket): void {
  const socketSet = chatSessionClients.get(sessionId);
  if (!socketSet) {
    return;
  }
  socketSet.delete(socket);
  if (socketSet.size === 0) {
    chatSessionClients.delete(sessionId);
  }
}

function broadcastChat(sessionId: string, message: ChatWsServerMessage): void {
  const socketSet = chatSessionClients.get(sessionId);
  if (!socketSet) {
    return;
  }
  const payload = JSON.stringify(message);
  for (const socket of socketSet) {
    if (socket.readyState === 1) {
      socket.send(payload);
    }
  }
}

// ---------------------------------- Queue Helpers ----------------------------------
async function loadQueue(sessionId: string): Promise<ChatQueueItem[]> {
  return db.listSessionQueue(sessionId);
}

async function broadcastQueueUpdate(sessionId: string): Promise<void> {
  const queue = await loadQueue(sessionId);
  broadcastChat(sessionId, { type: 'queue-updated', queue });
}

async function tryProcessQueue(sessionId: string): Promise<void> {
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
      onStream: (line) => broadcastChat(sessionId, { type: 'stream', data: line }),
      onDone: () => {
        broadcastChat(sessionId, { type: 'done' });
        void broadcastQueueUpdate(sessionId);
        void tryProcessQueue(sessionId);
      },
      onError: (message, code) => {
        broadcastChat(sessionId, { type: 'error', message, code });
        void broadcastQueueUpdate(sessionId);
        void tryProcessQueue(sessionId);
      },
      onHistory: () => {}
    };
    const result = await dispatchPrompt({
      sessionId,
      text: next.text,
      model: next.model,
      imagePaths: next.imagePaths,
      subscriber: sub
    });
    if (result.error) {
      broadcastChat(sessionId, { type: 'error', message: result.error, code: result.errorCode });
      void tryProcessQueue(sessionId);
    }
  } finally {
    queueWorkers.delete(sessionId);
  }
}

function paginateMessages(allMessages: ChatMessage[], offset: number): { messages: ChatMessage[]; hasMore: boolean } {
  const total = allMessages.length;
  const endIdx = Math.max(0, total - offset);
  const startIdx = Math.max(0, endIdx - HISTORY_PAGE_SIZE);
  return {
    messages: allMessages.slice(startIdx, endIdx),
    hasMore: startIdx > 0
  };
}

async function loadSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const run = getActiveRun(sessionId);
  if (run) {
    return run.messages;
  }
  const session = await db.getSession(sessionId);
  if (!session) {
    return [];
  }
  try {
    return JSON.parse(session.messageJson ?? '[]');
  } catch {
    return [];
  }
}

// ---------------------------------- Routes ----------------------------------
export async function chatRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/ws/chat/:id', { websocket: true }, async (socket: WebSocket, request) => {
    const query = request.query as Record<string, string>;
    const token = query['token'];
    if (!token) {
      socket.close(4001, 'Missing token');
      return;
    }
    try {
      await verifyToken(token);
    } catch {
      socket.close(4001, 'Invalid token');
      return;
    }

    const { id } = request.params as { id: string };
    const session = await db.getSession(id);
    if (!session) {
      socket.close(4004, 'Session not found');
      return;
    }

    registerChatSocket(id, socket);

    const existingRun = getActiveRun(id);
    const queue = await loadQueue(id);
    let activeRunSubscriber: ChatSubscriber | null = null;
    if (existingRun) {
      const sub: ChatSubscriber = {
        onStream: (line) => send(socket, { type: 'stream', data: line }),
        onDone: () => send(socket, { type: 'done' }),
        onError: (message, code) => send(socket, { type: 'error', message, code }),
        onHistory: () => {}
      };
      existingRun.subscribers.add(sub);
      activeRunSubscriber = sub;

      const { messages: page, hasMore } = paginateMessages(existingRun.messages, 0);
      send(socket, { type: 'history', messages: page, hasMore, streaming: true, queue });
      for (const line of existingRun.bufferedLines) {
        send(socket, { type: 'stream', data: line });
      }
    } else {
      let allMessages: ChatMessage[] = [];
      try {
        allMessages = JSON.parse(session.messageJson ?? '[]');
      } catch {
        allMessages = [];
      }
      const { messages: page, hasMore } = paginateMessages(allMessages, 0);
      send(socket, { type: 'history', messages: page, hasMore, queue });
    }

    socket.on('message', async (raw: Buffer) => {
      try {
        const clientMessage = JSON.parse(raw.toString()) as ChatWsClientMessage;

        if (clientMessage.type === 'cancel') {
          cancelRun(id);
          return;
        }

        if (clientMessage.type === 'load-more') {
          const offset = clientMessage.offset ?? 0;
          const allMessages = await loadSessionMessages(id);
          const { messages: page, hasMore } = paginateMessages(allMessages, offset);
          send(socket, { type: 'history-page', messages: page, hasMore });
          return;
        }

        if (clientMessage.type === 'queue-delete') {
          if (!clientMessage.queueItemId) {
            return;
          }
          await db.deleteSessionQueueItem(id, clientMessage.queueItemId);
          await broadcastQueueUpdate(id);
          return;
        }

        if (clientMessage.type === 'queue-push') {
          if (!clientMessage.queueItemId) {
            return;
          }
          const moved = await db.moveSessionQueueItemToFront(id, clientMessage.queueItemId);
          if (moved) {
            cancelRun(id);
          }
          await broadcastQueueUpdate(id);
          await tryProcessQueue(id);
          return;
        }

        if (clientMessage.type !== 'prompt') {
          return;
        }
        const text = (clientMessage.text ?? '').trim();
        const imagePaths = clientMessage.imagePaths ?? [];
        if (!text && imagePaths.length === 0) {
          return;
        }

        await db.enqueueSessionQueueItem({
          sessionId: id,
          text,
          model: clientMessage.model ?? session.modelSelection ?? 'auto',
          imagePaths
        });
        await broadcastQueueUpdate(id);
        await tryProcessQueue(id);
      } catch (err) {
        console.warn('[chat] malformed ws message from client:', err);
      }
    });

    socket.on('close', () => {
      unregisterChatSocket(id, socket);
      if (activeRunSubscriber) {
        const active = getActiveRun(id);
        active?.subscribers.delete(activeRunSubscriber);
      }
    });
  });
}
