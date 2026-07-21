// node_modules
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

// classes
import { verifyToken } from '../classes/auth';
import { sessionManager } from '../classes/sessionManager';
import { db } from '../classes/database';
import { normalizeSessionForApi } from '../classes/sessionNormalize';
import { getActiveSessionIds } from './chat';
import { subscribeBusy } from '../classes/chatEngine';
import { registerSessionListBroadcaster } from '../classes/sessionListBroadcast';
import { workspaceTerminalManager } from '../classes/workspaceTerminalManager';

// types
import type { WsClientMessage, WsServerMessage } from '../@types/index';

const wsClients = new Set<WebSocket>();
const workspaceSessionClients = new Map<string, Set<WebSocket>>();
const globalSessionClients = new Set<WebSocket>();

function sendJson(socket: WebSocket, msg: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function broadcastWorkspace(workspaceId: string, msg: unknown): void {
  const set = workspaceSessionClients.get(workspaceId);
  if (!set) return;
  const payload = JSON.stringify(msg);
  for (const socket of set) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

function broadcastGlobalSessions(msg: unknown): void {
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

export function broadcastServerShutdown(): void {
  const msg: WsServerMessage = { type: 'server-shutdown' };
  const payload = JSON.stringify(msg);
  for (const socket of wsClients) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}

export async function wsRoutes(fastify: FastifyInstance): Promise<void> {
  // install busy hook once (broadcast busy state to workspace session list sockets)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globalAny = globalThis as any;
  if (!globalAny.__busyHookInstalled) {
    globalAny.__busyHookInstalled = true;
    subscribeBusy((sessionId, workspaceId, busy) => {
      broadcastWorkspace(workspaceId, { type: 'busy-changed', id: sessionId, busy });
      broadcastGlobalSessions({ type: 'busy-changed', id: sessionId, busy, workspaceId });
    });
  }

  fastify.get('/api/ws/session/:id', { websocket: true }, async (socket: WebSocket, request) => {
    wsClients.add(socket);
    // Validate JWT from query param
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
    const live = sessionManager.get(id);
    if (!live) {
      socket.close(4004, 'Session not found');
      return;
    }

    const send = (msg: WsServerMessage): void => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(msg));
      }
    };

    // Send full history immediately
    if (live.pty) {
      const history = live.pty.history;
      if (history) {
        send({ type: 'history', data: history });
      }
    }

    // Send current status
    send({ type: 'status', status: live.meta.status });

    // Subscribe to new output
    const outputHandler = (data: string): void => {
      send({ type: 'output', data });
    };

    const statusHandler = (status: typeof live.meta.status): void => {
      send({ type: 'status', status });
    };

    live.pty?.subscribe(outputHandler);
    sessionManager.subscribeStatus(id, statusHandler);

    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as WsClientMessage;
        if (msg.type === 'input' && msg.data !== undefined) {
          live.pty?.write(msg.data);
        } else if (msg.type === 'resize' && msg.cols && msg.rows) {
          live.pty?.resize(msg.cols, msg.rows);
        }
      } catch {
        // ignore malformed messages
      }
    });

    socket.on('close', () => {
      wsClients.delete(socket);
      live.pty?.unsubscribe(outputHandler);
      sessionManager.unsubscribeStatus(id, statusHandler);
    });
  });

  fastify.get(
    '/api/ws/workspaces/:workspaceId/sessions/:sessionId/terminal',
    { websocket: true },
    async (socket: WebSocket, request) => {
      wsClients.add(socket);
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

      const { workspaceId, sessionId } = request.params as {
        workspaceId: string;
        sessionId: string;
      };
      const [workspace, session] = await Promise.all([
        db.getWorkspace(workspaceId),
        db.getSession(sessionId)
      ]);
      if (!workspace || !session || session.workspaceId !== workspaceId) {
        socket.close(4004, 'Session not found');
        return;
      }

      let live: ReturnType<typeof workspaceTerminalManager.getOrCreate>;
      try {
        live = workspaceTerminalManager.getOrCreate(sessionId, workspace);
      } catch (error) {
        socket.close(4005, error instanceof Error ? error.message : 'Failed to start terminal');
        return;
      }

      const send = (msg: WsServerMessage): void => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(msg));
        }
      };

      const history = live.pty.history;
      if (history) {
        send({ type: 'history', data: history });
      }
      send({ type: 'status', status: live.status });

      const outputHandler = (data: string): void => {
        send({ type: 'output', data });
      };
      const statusHandler = (status: typeof live.status): void => {
        send({ type: 'status', status });
      };

      live.pty.subscribe(outputHandler);
      workspaceTerminalManager.subscribeStatus(sessionId, statusHandler);

      socket.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString()) as WsClientMessage;
          if (msg.type === 'input' && msg.data !== undefined) {
            live.pty.write(msg.data);
          } else if (msg.type === 'resize' && msg.cols && msg.rows) {
            live.pty.resize(msg.cols, msg.rows);
          }
        } catch {
          // ignore malformed messages
        }
      });

      socket.on('close', () => {
        wsClients.delete(socket);
        live.pty.unsubscribe(outputHandler);
        workspaceTerminalManager.unsubscribeStatus(sessionId, statusHandler);
      });
    }
  );

  fastify.get(
    '/api/ws/sessions',
    { websocket: true },
    async (socket: WebSocket, request) => {
      wsClients.add(socket);
      globalSessionClients.add(socket);
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

      const busyIds = getActiveSessionIds();
      const allWorkspaces = await db.listWorkspaces({ includeArchived: true });
      const byWorkspace = await Promise.all(
        allWorkspaces.map((w) =>
          Promise.all([
            db.listSessionsByWorkspace(w.id, { archived: false }),
            db.listSessionsByWorkspace(w.id, { archived: true })
          ])
        )
      );
      const allSessions = byWorkspace
        .flatMap(([active, archived]) => [...active, ...archived])
        .map((s) => ({ ...normalizeSessionForApi(s), busy: busyIds.has(s.id) }));
      await db.enrichSessionListPreviews(allSessions);
      sendJson(socket, { type: 'global-snapshot', sessions: allSessions });

      socket.on('close', () => {
        wsClients.delete(socket);
        globalSessionClients.delete(socket);
      });
    }
  );

  fastify.get(
    '/api/ws/workspaces/:workspaceId/sessions',
    { websocket: true },
    async (socket: WebSocket, request) => {
      wsClients.add(socket);
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

      const { workspaceId } = request.params as { workspaceId: string };
      const workspace = await db.getWorkspace(workspaceId);
      if (!workspace) {
        socket.close(4004, 'Workspace not found');
        return;
      }

      let set = workspaceSessionClients.get(workspaceId);
      if (!set) {
        set = new Set<WebSocket>();
        workspaceSessionClients.set(workspaceId, set);
      }
      set.add(socket);

      // initial snapshot (active + archived), with busy flags
      const busyIds = getActiveSessionIds();
      const [active, archived] = await Promise.all([
        db.listSessionsByWorkspace(workspaceId, { archived: false }),
        db.listSessionsByWorkspace(workspaceId, { archived: true })
      ]);
      const enrich = (rows: { tags?: unknown }[]) =>
        rows.map((s) => ({ ...normalizeSessionForApi(s), busy: busyIds.has((s as { id: string }).id) }));
      sendJson(socket, { type: 'snapshot', active: enrich(active), archived: enrich(archived) });

      socket.on('close', () => {
        wsClients.delete(socket);
        const s = workspaceSessionClients.get(workspaceId);
        s?.delete(socket);
        if (s && s.size === 0) workspaceSessionClients.delete(workspaceId);
      });
    }
  );
}
