import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { WebSocket } from 'ws';

const authGate = vi.hoisted(() => ({
  next: null as null | ((rejected: boolean) => void)
}));
const db = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  listSessions: vi.fn(),
  listSessionsByWorkspace: vi.fn(),
  enrichSessionListPreviews: vi.fn(),
  listOrchestratorSummaries: vi.fn()
}));

// Auth resolves only when the test says so; `true` = rejected with 4001.
vi.mock('../classes/auth', () => ({
  rejectUnauthorizedWebSocket: (socket: { close: (code: number, reason: string) => void }): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      authGate.next = (rejected): void => {
        if (rejected) socket.close(4001, 'Invalid token');
        resolve(rejected);
      };
    });
  }
}));
vi.mock('../classes/database', () => ({ db }));
vi.mock('../classes/chatSockets', () => ({ hasChatSessionViewers: (): boolean => false }));
vi.mock('../classes/chatEngine', () => ({
  getActiveSessionIds: (): Set<string> => new Set(),
  getActiveBusySubagents: (): null => null,
  subscribeBusy: vi.fn()
}));
vi.mock('../classes/sessionUnread', () => ({ markSessionFinishedUnread: vi.fn() }));
vi.mock('../classes/sessionManager', () => ({ sessionManager: { get: (): undefined => undefined } }));
vi.mock('../classes/workspaceTerminalManager', () => ({ workspaceTerminalManager: {} }));

import { groupSessionsByWorkspace, wsRoutes } from './ws';
import { broadcastWorkspaceSessionsRefresh, wsClientCounts } from '../classes/wsBroadcast';

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  app = Fastify();
  await app.register(fastifyWebsocket);
  await app.register(wsRoutes);
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = address.replace(/^http/, 'ws');
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.unstubAllEnvs();
  db.getWorkspace.mockResolvedValue({ id: 'w1' });
  db.listWorkspaces.mockResolvedValue([{ id: 'w1' }]);
  db.listSessions.mockResolvedValue([]);
  db.listSessionsByWorkspace.mockResolvedValue([]);
  db.enrichSessionListPreviews.mockResolvedValue(undefined);
  db.listOrchestratorSummaries.mockResolvedValue([]);
});

function collect(ws: WebSocket): { frames: { type: string }[]; closed: Promise<number> } {
  const frames: { type: string }[] = [];
  ws.on('message', (raw: Buffer) => frames.push(JSON.parse(raw.toString()) as { type: string }));
  const closed = new Promise<number>((resolve) => ws.on('close', (code: number) => resolve(code)));
  return { frames, closed };
}

function connect(path: string, headers: Record<string, string> = {}): Promise<WebSocket> {
  const ws = new WebSocket(baseUrl + path, { headers });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

async function open(path: string): Promise<WebSocket> {
  const ws = await connect(path);
  await vi.waitFor(() => expect(authGate.next).not.toBeNull());
  return ws;
}

function resolveAuth(rejected: boolean): void {
  const next = authGate.next;
  authGate.next = null;
  next?.(rejected);
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

describe('ws routes — socket registration', () => {
  it('keeps a socket out of every set while auth is pending and after rejection', async () => {
    const ws = await open('/api/ws/workspaces/w1/sessions');
    const { frames, closed } = collect(ws);

    expect(wsClientCounts()).toEqual({ all: 0, global: 0, workspace: {} });
    broadcastWorkspaceSessionsRefresh('w1');

    resolveAuth(true);
    expect(await closed).toBe(4001);
    await settle();
    expect(frames).toEqual([]);
    expect(wsClientCounts()).toEqual({ all: 0, global: 0, workspace: {} });
  });

  it('registers an accepted socket and removes it on close', async () => {
    const ws = await open('/api/ws/sessions');
    const { frames, closed } = collect(ws);
    resolveAuth(false);
    await vi.waitFor(() => expect(frames.map((f) => f.type)).toContain('global-snapshot'));
    expect(wsClientCounts()).toMatchObject({ all: 1, global: 1 });

    broadcastWorkspaceSessionsRefresh('w1');
    await vi.waitFor(() => expect(frames.map((f) => f.type)).toContain('refresh'));

    ws.close();
    await closed;
    await vi.waitFor(() => expect(wsClientCounts()).toEqual({ all: 0, global: 0, workspace: {} }));
  });

  it('removes a socket rejected with 4004 after auth', async () => {
    db.getWorkspace.mockResolvedValue(null);
    const ws = await open('/api/ws/workspaces/missing/sessions');
    const { closed } = collect(ws);
    resolveAuth(false);
    expect(await closed).toBe(4004);
    await vi.waitFor(() => expect(wsClientCounts()).toEqual({ all: 0, global: 0, workspace: {} }));
  });

  it('removes a 4004 auth-session socket', async () => {
    const ws = await open('/api/ws/session/nope');
    const { closed } = collect(ws);
    resolveAuth(false);
    expect(await closed).toBe(4004);
    await vi.waitFor(() => expect(wsClientCounts().all).toBe(0));
  });

  it('rejects a foreign Origin with 4003 before auth', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CORS_ORIGIN', '');
    const ws = await connect('/api/ws/sessions', { origin: 'https://evil.example', host: 'nova.example' });
    const { closed } = collect(ws);
    expect(await closed).toBe(4003);
    expect(authGate.next).toBeNull();
    expect(wsClientCounts()).toEqual({ all: 0, global: 0, workspace: {} });
  });

  it('accepts an Origin equal to the request host or in the CORS allowlist', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CORS_ORIGIN', 'https://app.example');
    const allowed = [
      { origin: 'https://nova.example', host: 'nova.example' },
      { origin: 'https://app.example', host: 'nova.example' }
    ];
    for (const headers of allowed) {
      const ws = await connect('/api/ws/sessions', headers);
      const { frames, closed } = collect(ws);
      await vi.waitFor(() => expect(authGate.next).not.toBeNull());
      resolveAuth(false);
      await vi.waitFor(() => expect(frames.map((f) => f.type)).toContain('global-snapshot'));
      expect(wsClientCounts()).toMatchObject({ all: 1, global: 1 });
      ws.close();
      await closed;
      await vi.waitFor(() => expect(wsClientCounts()).toEqual({ all: 0, global: 0, workspace: {} }));
    }
  });

  it('uses a single listSessions query for the global snapshot', async () => {
    db.listWorkspaces.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);
    db.listSessions.mockResolvedValue([
      { id: 's1', workspaceId: 'w2', archived: false },
      { id: 's2', workspaceId: 'w1', archived: true },
      { id: 's3', workspaceId: 'w1', archived: false }
    ]);
    const ws = await open('/api/ws/sessions');
    const { frames, closed } = collect(ws);
    resolveAuth(false);
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
    const snapshot = frames[0] as unknown as { sessions: { id: string }[] };
    expect(snapshot.sessions.map((s) => s.id)).toEqual(['s3', 's2', 's1']);
    expect(db.listSessions).toHaveBeenCalledTimes(1);
    expect(db.listSessionsByWorkspace).not.toHaveBeenCalled();
    ws.close();
    await closed;
  });

  it('uses a single listSessionsByWorkspace query for the workspace snapshot', async () => {
    db.listSessionsByWorkspace.mockResolvedValue([
      { id: 's1', workspaceId: 'w1', archived: false },
      { id: 's2', workspaceId: 'w1', archived: true },
      { id: 's3', workspaceId: 'w1', archived: false }
    ]);
    const ws = await open('/api/ws/workspaces/w1/sessions');
    const { frames, closed } = collect(ws);
    resolveAuth(false);
    await vi.waitFor(() => expect(frames.map((f) => f.type)).toContain('snapshot'));
    const snapshot = frames.find((f) => f.type === 'snapshot') as unknown as {
      active: { id: string }[];
      archived: { id: string }[];
    };
    expect(snapshot.active.map((s) => s.id)).toEqual(['s1', 's3']);
    expect(snapshot.archived.map((s) => s.id)).toEqual(['s2']);
    expect(db.listSessionsByWorkspace).toHaveBeenCalledTimes(1);
    expect(db.listSessionsByWorkspace).toHaveBeenCalledWith('w1');
    ws.close();
    await closed;
  });

  it('answers an app-level ping with a pong once accepted', async () => {
    const ws = await open('/api/ws/sessions');
    const { frames, closed } = collect(ws);
    resolveAuth(false);
    await vi.waitFor(() => expect(frames.map((f) => f.type)).toContain('global-snapshot'));
    ws.send(JSON.stringify({ type: 'ping' }));
    await vi.waitFor(() => expect(frames.map((f) => f.type)).toContain('pong'));
    ws.close();
    await closed;
  });
});

describe('groupSessionsByWorkspace', () => {
  it('orders by workspace, active before archived, and drops unknown workspaces', () => {
    const sessions = [
      { id: 'a', workspaceId: 'w2', archived: true },
      { id: 'b', workspaceId: 'w1', archived: true },
      { id: 'c', workspaceId: 'w2', archived: false },
      { id: 'd', workspaceId: 'gone', archived: false },
      { id: 'e', workspaceId: 'w1', archived: false }
    ];
    expect(groupSessionsByWorkspace([{ id: 'w1' }, { id: 'w2' }], sessions).map((s) => s.id)).toEqual([
      'e',
      'b',
      'c',
      'a'
    ]);
  });
});
