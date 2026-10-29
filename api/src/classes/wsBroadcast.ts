// node_modules
import type { WebSocket } from 'ws';

// classes
import { registerSessionListBroadcaster } from './sessionListBroadcast';

// types
import type { AutomationRunFinishedMessage, WsServerMessage } from '../@types/index';

const wsClients = new Set<WebSocket>();
const workspaceSessionClients = new Map<string, Set<WebSocket>>();
const globalSessionClients = new Set<WebSocket>();

/** Add an accepted socket to a client set; it leaves the set on close. */
function trackClient(socket: WebSocket, set: Set<WebSocket>): void {
  set.add(socket);
  socket.on('close', () => set.delete(socket));
}

/** Track an accepted socket so it gets the server-shutdown notice. */
export function trackWsClient(socket: WebSocket): void {
  trackClient(socket, wsClients);
}

/** Add a socket to the all-workspaces session-list clients. */
export function trackGlobalSessionClient(socket: WebSocket): void {
  trackClient(socket, globalSessionClients);
}

/** Add a socket to a workspace's session-list clients; it leaves on close. */
export function trackWorkspaceClient(workspaceId: string, socket: WebSocket): void {
  let set = workspaceSessionClients.get(workspaceId);
  if (!set) {
    set = new Set<WebSocket>();
    workspaceSessionClients.set(workspaceId, set);
  }
  set.add(socket);
  socket.on('close', () => {
    const s = workspaceSessionClients.get(workspaceId);
    s?.delete(socket);
    if (s && s.size === 0) workspaceSessionClients.delete(workspaceId);
  });
}

/** Client set sizes, for tests. */
export function wsClientCounts(): { all: number; global: number; workspace: Record<string, number> } {
  const workspace: Record<string, number> = {};
  for (const [workspaceId, set] of workspaceSessionClients) {
    workspace[workspaceId] = set.size;
  }
  return { all: wsClients.size, global: globalSessionClients.size, workspace };
}

export function sendJson(socket: WebSocket, msg: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

export function broadcastWorkspace(workspaceId: string, msg: unknown): void {
  const set = workspaceSessionClients.get(workspaceId);
  if (!set) return;
  const payload = JSON.stringify(msg);
  for (const socket of set) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

export function broadcastGlobalSessions(msg: unknown): void {
  const payload = JSON.stringify(msg);
  for (const socket of globalSessionClients) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

export function broadcastWorkspaceSessionUpsert(workspaceId: string, session: unknown): void {
  broadcastWorkspace(workspaceId, { type: 'session-upsert', session });
  broadcastGlobalSessions({ type: 'session-upsert', session });
}

registerSessionListBroadcaster(broadcastWorkspaceSessionUpsert);

export function broadcastWorkspaceSessionDeleted(workspaceId: string, id: string): void {
  broadcastWorkspace(workspaceId, { type: 'session-deleted', id });
  broadcastGlobalSessions({ type: 'session-deleted', id, workspaceId });
}

export function broadcastWorkspaceSessionsRefresh(workspaceId: string): void {
  broadcastWorkspace(workspaceId, { type: 'refresh' });
  broadcastGlobalSessions({ type: 'refresh' });
}

/** Push orchestrator run-state changes so dashboards don't need to poll. */
export function broadcastOrchestratorUpsert(workspaceId: string, orchestrator: unknown): void {
  broadcastWorkspace(workspaceId, { type: 'orchestrator-upsert', orchestrator });
  broadcastGlobalSessions({ type: 'orchestrator-upsert', orchestrator });
}

/** Spec file / spec→orchestrator job state changed for a chat session. */
export function broadcastSessionSpecStatus(workspaceId: string, status: unknown): void {
  broadcastWorkspace(workspaceId, { type: 'session-spec-status', status });
  broadcastGlobalSessions({ type: 'session-spec-status', status });
}

/** An automation run finished (success or failure). */
export function broadcastAutomationRunFinished(
  workspaceId: string,
  payload: Omit<AutomationRunFinishedMessage, 'type'>
): void {
  const msg: AutomationRunFinishedMessage = { type: 'automation-run-finished', ...payload };
  broadcastWorkspace(workspaceId, msg);
  broadcastGlobalSessions(msg);
}

export function broadcastServerShutdown(): void {
  const msg: WsServerMessage = { type: 'server-shutdown' };
  const payload = JSON.stringify(msg);
  for (const socket of wsClients) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}
