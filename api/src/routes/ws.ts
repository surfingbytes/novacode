// node_modules
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

// classes
import { acceptWebSocket } from '../classes/wsAccept';
import { sessionManager } from '../classes/sessionManager';
import { db } from '../classes/database';
import { normalizeSessionForApi } from '../classes/sessionNormalize';
import { getActiveSessionIds, getActiveBusySubagents, subscribeBusy } from '../classes/chatEngine';
import { hasChatSessionViewers } from '../classes/chatSockets';
import {
  broadcastGlobalSessions,
  broadcastWorkspace,
  sendJson,
  trackGlobalSessionClient,
  trackWorkspaceClient,
  trackWsClient
} from '../classes/wsBroadcast';
import { markSessionFinishedUnread } from '../classes/sessionUnread';
import { workspaceTerminalManager } from '../classes/workspaceTerminalManager';
import { WS_ROUTE_RATE_LIMIT } from '../classes/rateLimits';

// types
import type { WsClientMessage, WsServerMessage } from '../@types/index';

const SessionIdParamsSchema = Type.Object({ id: Type.String() });
const TerminalParamsSchema = Type.Object({ workspaceId: Type.String(), sessionId: Type.String() });
const WorkspaceParamsSchema = Type.Object({ workspaceId: Type.String() });

/**
 * Order sessions like the old per-workspace queries: workspace order, then
 * active before archived, each keeping the incoming (updatedAt desc) order.
 */
export function groupSessionsByWorkspace<S extends { workspaceId: string; archived: boolean }>(
  workspaces: { id: string }[],
  sessions: S[]
): S[] {
  const byWorkspace = new Map<string, { active: S[]; archived: S[] }>();
  for (const workspace of workspaces) {
    byWorkspace.set(workspace.id, { active: [], archived: [] });
  }
  for (const session of sessions) {
    const group = byWorkspace.get(session.workspaceId);
    if (!group) continue;
    (session.archived ? group.archived : group.active).push(session);
  }
  return [...byWorkspace.values()].flatMap((group) => [...group.active, ...group.archived]);
}

export async function wsRoutes(fastify: FastifyInstance): Promise<void> {
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // install busy hook once (broadcast busy state to workspace session list sockets)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globalAny = globalThis as any;
  if (!globalAny.__busyHookInstalled) {
    globalAny.__busyHookInstalled = true;
    subscribeBusy((sessionId, workspaceId, busy, subagents) => {
      broadcastWorkspace(workspaceId, {
        type: 'busy-changed',
        id: sessionId,
        busy,
        busySubagents: busy ? subagents ?? null : null,
      });
      broadcastGlobalSessions({
        type: 'busy-changed',
        id: sessionId,
        busy,
        busySubagents: busy ? subagents ?? null : null,
        workspaceId,
      });
      if (!busy) {
        void markSessionFinishedUnread(sessionId, hasChatSessionViewers(sessionId));
      }
    });
  }

  fastifyInstance.get('/api/ws/session/:id', { websocket: true, config: { rateLimit: WS_ROUTE_RATE_LIMIT }, schema: { params: SessionIdParamsSchema } }, async (socket: WebSocket, request) => {
    if (!(await acceptWebSocket(socket, request))) {
      return;
    }
    trackWsClient(socket);

    const { id } = request.params;
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
    sessionManager.touch(id);

    socket.on('message', (raw: Buffer) => {
      sessionManager.touch(id);
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
      live.pty?.unsubscribe(outputHandler);
      sessionManager.unsubscribeStatus(id, statusHandler);
    });
  });

  fastifyInstance.get(
    '/api/ws/workspaces/:workspaceId/sessions/:sessionId/terminal',
    { websocket: true, config: { rateLimit: WS_ROUTE_RATE_LIMIT }, schema: { params: TerminalParamsSchema } },
    async (socket: WebSocket, request) => {
      if (!(await acceptWebSocket(socket, request))) {
        return;
      }
      trackWsClient(socket);

      const { workspaceId, sessionId } = request.params;
      const [workspace, session] = await Promise.all([
        db.getWorkspace(workspaceId),
        db.getSession(sessionId)
      ]);
      if (!workspace || !session || session.workspaceId !== workspaceId) {
        socket.close(4004, 'Session not found');
        return;
      }
      if (socket.readyState !== socket.OPEN) {
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
        live.pty.unsubscribe(outputHandler);
        workspaceTerminalManager.unsubscribeStatus(sessionId, statusHandler);
      });
    }
  );

  fastifyInstance.get(
    '/api/ws/sessions',
    { websocket: true, config: { rateLimit: WS_ROUTE_RATE_LIMIT } },
    async (socket: WebSocket, request) => {
      if (!(await acceptWebSocket(socket, request))) {
        return;
      }
      trackWsClient(socket);
      trackGlobalSessionClient(socket);

      const busyIds = getActiveSessionIds();
      const [allWorkspaces, sessions] = await Promise.all([
        db.listWorkspaces({ includeArchived: true }),
        db.listSessions()
      ]);
      const allSessions = groupSessionsByWorkspace(allWorkspaces, sessions)
        .map((s) => ({
          ...normalizeSessionForApi(s),
          busy: busyIds.has(s.id),
          busySubagents: getActiveBusySubagents(s.id),
        }));
      await db.enrichSessionListPreviews(allSessions);
      const orchestrators = await db.listOrchestratorSummaries();
      sendJson(socket, { type: 'global-snapshot', sessions: allSessions, orchestrators });
    }
  );

  fastifyInstance.get(
    '/api/ws/workspaces/:workspaceId/sessions',
    { websocket: true, config: { rateLimit: WS_ROUTE_RATE_LIMIT }, schema: { params: WorkspaceParamsSchema } },
    async (socket: WebSocket, request) => {
      if (!(await acceptWebSocket(socket, request))) {
        return;
      }
      trackWsClient(socket);

      const { workspaceId } = request.params;
      const workspace = await db.getWorkspace(workspaceId);
      if (!workspace) {
        socket.close(4004, 'Workspace not found');
        return;
      }
      if (socket.readyState !== socket.OPEN) {
        return;
      }

      trackWorkspaceClient(workspaceId, socket);

      // initial snapshot (active + archived), with busy flags — one query, split in memory
      const busyIds = getActiveSessionIds();
      const rows = await db.listSessionsByWorkspace(workspaceId);
      const enrich = (list: typeof rows) =>
        list.map((s) => ({
          ...normalizeSessionForApi(s),
          busy: busyIds.has(s.id),
          busySubagents: getActiveBusySubagents(s.id),
        }));
      sendJson(socket, {
        type: 'snapshot',
        active: enrich(rows.filter((s) => !s.archived)),
        archived: enrich(rows.filter((s) => s.archived))
      });
    }
  );
}
