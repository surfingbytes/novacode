// node_modules
import type { WebSocket } from 'ws';

// classes
import { getActiveRun, subscribeBusy } from './chatEngine';
import { markSessionRead } from './sessionUnread';

// types
import type { ChatApprovalRequest, ChatQuestionRequest, ChatWsServerMessage } from '../@types/index';

const chatSessionClients = new Map<string, Set<WebSocket>>();

/** True when at least one chat WebSocket is connected to this session (a viewer). */
export function hasChatSessionViewers(sessionId: string): boolean {
  return (chatSessionClients.get(sessionId)?.size ?? 0) > 0;
}

export function sendChat(socket: WebSocket, message: ChatWsServerMessage): void {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

export function registerChatSocket(sessionId: string, socket: WebSocket): void {
  let socketSet = chatSessionClients.get(sessionId);
  if (!socketSet) {
    socketSet = new Set<WebSocket>();
    chatSessionClients.set(sessionId, socketSet);
  }
  socketSet.add(socket);
  void markSessionRead(sessionId);
}

export function unregisterChatSocket(sessionId: string, socket: WebSocket): void {
  const socketSet = chatSessionClients.get(sessionId);
  if (!socketSet) {
    return;
  }
  socketSet.delete(socket);
  if (socketSet.size === 0) {
    chatSessionClients.delete(sessionId);
  }
}

export function broadcastChat(sessionId: string, message: ChatWsServerMessage): void {
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

/**
 * Install once: give EVERY run (queue-dispatched, orchestrator, automation,
 * auto-continue) a single session-wide broadcast subscriber, attached
 * synchronously at run start (busy fires before the agent emits anything).
 * This is the ONLY live-delivery path — per-socket subscribers on top of it
 * would deliver every line twice to mid-run joiners.
 */
export function installChatRunBroadcast(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globalAny = globalThis as any;
  if (globalAny.__chatBroadcastHookInstalled) {
    return;
  }
  globalAny.__chatBroadcastHookInstalled = true;
  // busy=true re-fires on every subagent count update; attach once per run.
  const runsWithBroadcast = new WeakSet<object>();
  subscribeBusy((sessionId, _workspaceId, busy) => {
    if (!busy) return;
    const run = getActiveRun(sessionId);
    if (!run || runsWithBroadcast.has(run)) return;
    runsWithBroadcast.add(run);
    run.subscribers.add({
      onStream: (line) => broadcastChat(sessionId, { type: 'stream', data: line }),
      onDone: () => broadcastChat(sessionId, { type: 'done' }),
      onError: (message, code) => broadcastChat(sessionId, { type: 'error', message, code }),
      onHistory: () => {},
      onApprovalRequested: (approval: ChatApprovalRequest) =>
        broadcastChat(sessionId, { type: 'approval-requested', approval }),
      onApprovalResolved: (approvalRequestId: string) =>
        broadcastChat(sessionId, { type: 'approval-resolved', approvalRequestId }),
      onQuestionRequested: (question: ChatQuestionRequest) =>
        broadcastChat(sessionId, { type: 'question-requested', question }),
      onQuestionResolved: (questionRequestId: string) =>
        broadcastChat(sessionId, { type: 'question-resolved', questionRequestId })
    });
  });
}
