// node_modules
import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import type { WebSocket } from 'ws';

// classes
import { jwtPreHandler } from '../classes/auth';
import { db } from '../classes/database';
import { AGENT_ROUTE_RATE_LIMIT, WS_ROUTE_RATE_LIMIT } from '../classes/rateLimits';
import { acceptWebSocket } from '../classes/wsAccept';
import { startContinueInNewChat } from '../classes/sessionHandoff';
import { maybeNameUntitledSession } from '../classes/sessionTitle';
import {
  getActiveRun,
  cancelRun,
  respondToAcpPermission,
  respondToAcpAskQuestion
} from '../classes/chatEngine';
import {
  installChatRunBroadcast,
  registerChatSocket,
  sendChat as send,
  unregisterChatSocket
} from '../classes/chatSockets';
import {
  broadcastQueueUpdate,
  deleteQueueItem,
  drainQueue,
  editQueueItem,
  enqueuePrompt,
  loadQueue,
  pushQueueItemToFront
} from '../classes/chatQueue';
import { logger } from '../classes/logger';

// types
import type { ChatMessage, ChatWsClientMessage } from '../@types/index';

const HISTORY_PAGE_SIZE = 50;

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
  return db.listSessionMessages(sessionId);
}

// ---------------------------------- Schemas ----------------------------------
const ContinueInNewChatParamsSchema = Type.Object({
  workspaceId: Type.String(),
  sessionId: Type.String()
});

const ContinueInNewChatBodySchema = Type.Object({
  text: Type.Optional(Type.String()),
  imagePaths: Type.Optional(Type.Array(Type.String()))
});

const ChatSocketParamsSchema = Type.Object({ id: Type.String() });

// ---------------------------------- Routes ----------------------------------
export async function chatRoutes(fastify: FastifyInstance): Promise<void> {
  installChatRunBroadcast();

  // POST /api/workspaces/:workspaceId/sessions/:sessionId/continue-in-new-chat
  // Answers 202 at once: the summary turn can take minutes, completion is pushed
  // to the source chat's sockets as handoff-ready / handoff-failed.
  fastify.post(
    '/api/workspaces/:workspaceId/sessions/:sessionId/continue-in-new-chat',
    {
      preHandler: jwtPreHandler,
      config: { rateLimit: AGENT_ROUTE_RATE_LIMIT },
      schema: { params: ContinueInNewChatParamsSchema, body: ContinueInNewChatBodySchema }
    },
    async (request, reply) => {
      const { workspaceId, sessionId } = request.params as Static<typeof ContinueInNewChatParamsSchema>;
      const body = request.body as Static<typeof ContinueInNewChatBodySchema>;
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const imagePaths = Array.isArray(body.imagePaths)
        ? body.imagePaths.filter((path): path is string => typeof path === 'string')
        : [];
      if (!text && imagePaths.length === 0) {
        return reply.code(400).send({ error: 'Prompt is required' });
      }
      await startContinueInNewChat({ workspaceId, sessionId, text, imagePaths });
      return reply.code(202).send({ ok: true });
    }
  );

  fastify.get(
    '/api/ws/chat/:id',
    {
      websocket: true,
      config: { rateLimit: WS_ROUTE_RATE_LIMIT },
      schema: { params: ChatSocketParamsSchema }
    },
    async (socket: WebSocket, request) => {
    if (!(await acceptWebSocket(socket, request))) {
      return;
    }

    const { id } = request.params as Static<typeof ChatSocketParamsSchema>;
    // Attached before any await so a socket closing mid-load is always unregistered.
    socket.on('close', () => {
      unregisterChatSocket(id, socket);
    });
    const session = await db.getSession(id);
    if (!session) {
      socket.close(4004, 'Session not found');
      return;
    }

    // Load DB history BEFORE registering for broadcasts. Registering first, then
    // awaiting the DB, let prompt-started land and then a stale empty history
    // wipe the UI (named session, blank chat) — especially on a fast first send.
    let queue = await loadQueue(id);
    let existingRun = getActiveRun(id);
    if (!existingRun) {
      // Await DB before registering. Re-read once more so a run that started and
      // finished during the first fetch is not sent as a stale empty snapshot.
      await db.listSessionMessagesPage(id, 0, HISTORY_PAGE_SIZE);
      existingRun = getActiveRun(id);
      if (!existingRun) {
        const pageResult = await db.listSessionMessagesPage(id, 0, HISTORY_PAGE_SIZE);
        queue = await loadQueue(id);
        existingRun = getActiveRun(id);
        if (socket.readyState !== socket.OPEN) {
          return;
        }
        if (!existingRun) {
          registerChatSocket(id, socket);
          send(socket, {
            type: 'history',
            messages: pageResult.messages,
            hasMore: pageResult.hasMore,
            queue
          });
        }
      }
    }
    if (socket.readyState !== socket.OPEN) {
      return;
    }
    if (existingRun) {
      // Snapshot the buffer, replay it, THEN register for the session broadcast:
      // lines up to the snapshot are delivered once via the replay, lines after
      // registration arrive once via the broadcast. There are no awaits between
      // the snapshot and the registration, so no line can be missed or doubled.
      const bufferedSnapshot = [...existingRun.bufferedLines];
      const pendingApprovals = [...existingRun.pendingApprovals.values()].map((pending) => pending.approval);
      const pendingQuestions = [...existingRun.pendingQuestions.values()].map((pending) => pending.question);
      const { messages: page, hasMore } = paginateMessages(existingRun.messages, 0);
      send(socket, { type: 'history', messages: page, hasMore, streaming: true, queue });
      for (const line of bufferedSnapshot) {
        send(socket, { type: 'stream', data: line });
      }
      for (const approval of pendingApprovals) {
        send(socket, { type: 'approval-requested', approval });
      }
      for (const question of pendingQuestions) {
        send(socket, { type: 'question-requested', question });
      }
      registerChatSocket(id, socket);
      if (!getActiveRun(id)) {
        // The run finished while we replayed: every line is in the snapshot,
        // but the 'done' broadcast fired before this socket registered.
        send(socket, { type: 'done' });
      }
    }

    socket.on('message', async (raw: Buffer) => {
      try {
        const clientMessage = JSON.parse(raw.toString()) as ChatWsClientMessage;

        if (clientMessage.type === 'cancel') {
          cancelRun(id);
          return;
        }

        if (clientMessage.type === 'approval-response') {
          if (!clientMessage.approvalRequestId || !clientMessage.approvalOptionId) {
            return;
          }
          respondToAcpPermission(id, clientMessage.approvalRequestId, clientMessage.approvalOptionId);
          return;
        }

        if (clientMessage.type === 'question-response') {
          if (!clientMessage.questionRequestId) {
            return;
          }
          if (clientMessage.questionSkipped) {
            respondToAcpAskQuestion(id, clientMessage.questionRequestId, { skipped: true });
            return;
          }
          if (!clientMessage.questionAnswers) {
            return;
          }
          respondToAcpAskQuestion(id, clientMessage.questionRequestId, {
            answers: clientMessage.questionAnswers,
          });
          return;
        }

        if (clientMessage.type === 'load-more') {
          const offset = clientMessage.offset ?? 0;
          if (getActiveRun(id)) {
            const allMessages = await loadSessionMessages(id);
            const { messages: page, hasMore } = paginateMessages(allMessages, offset);
            send(socket, { type: 'history-page', messages: page, hasMore });
            return;
          }
          const { messages: page, hasMore } = await db.listSessionMessagesPage(
            id,
            offset,
            HISTORY_PAGE_SIZE
          );
          send(socket, { type: 'history-page', messages: page, hasMore });
          return;
        }

        if (clientMessage.type === 'queue-delete') {
          if (!clientMessage.queueItemId) {
            return;
          }
          await deleteQueueItem(id, clientMessage.queueItemId);
          return;
        }

        if (clientMessage.type === 'queue-edit') {
          if (!clientMessage.queueItemId || typeof clientMessage.text !== 'string') {
            return;
          }
          await editQueueItem(id, clientMessage.queueItemId, clientMessage.text);
          return;
        }

        if (clientMessage.type === 'queue-push') {
          if (!clientMessage.queueItemId) {
            return;
          }
          await pushQueueItemToFront(id, clientMessage.queueItemId);
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

        try {
          await enqueuePrompt({
            sessionId: id,
            text,
            model: clientMessage.model ?? session.modelSelection ?? 'auto',
            mode: clientMessage.mode ?? session.sessionMode ?? 'default',
            imagePaths
          });
        } catch (err) {
          // Tell the client: it already shows the user turn and a spinner, so a
          // silent failure looked like an agent that never started.
          logger.warn({ err }, 'chat: failed to enqueue prompt');
          send(socket, { type: 'error', message: 'Failed to send prompt, please retry' });
          return;
        }
        // Name only once the prompt is saved, so a failed send leaves no titled empty chat.
        void maybeNameUntitledSession(id, text, imagePaths);
        await broadcastQueueUpdate(id);
        await drainQueue(id);
      } catch (err) {
        logger.warn({ err }, 'chat: failed to handle ws message from client');
      }
    });
  });
}
