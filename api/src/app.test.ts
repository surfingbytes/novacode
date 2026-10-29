// node_modules
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  pingDatabase: vi.fn()
}));

// No database: keep the real helpers, replace `db` with the one call /api/health makes.
vi.mock('./classes/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./classes/database')>()),
  db: {
    pingDatabase: (...args: unknown[]) => mocks.pingDatabase(...args)
  }
}));

// app
import { buildApp } from './app';
import { NotFoundError } from './classes/httpErrors';

let app: FastifyInstance;
const logLines: string[] = [];

beforeAll(async () => {
  app = await buildApp({ logger: { level: 'error', stream: { write: (line: string) => logLines.push(line) } } });
  app.get('/api/test/not-found', async () => {
    throw new NotFoundError('Widget not found');
  });
  app.get('/api/test/crash', async () => {
    throw new Error('secret path /x');
  });
  app.get('/api/test/validated', { schema: { querystring: { type: 'object', required: ['n'] } } }, async () => ({}));
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('buildApp', () => {
  it('serves /api/health without listening', async () => {
    mocks.pingDatabase.mockResolvedValue(undefined);

    const res = await app.inject({ url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', dbOk: true });
    expect(app.server.listening).toBe(false);
  });

  it('reports degraded health when the database ping fails', async () => {
    mocks.pingDatabase.mockRejectedValue(new Error('down'));

    const res = await app.inject({ url: '/api/health' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', dbOk: false });
  });

  it('registers the API routes behind auth', async () => {
    expect(app.hasRoute({ method: 'GET', url: '/api/workspaces' })).toBe(true);

    const res = await app.inject({ url: '/api/workspaces' });

    expect(res.statusCode).toBe(401);
  });

  it('answers a thrown HttpError with its status and message', async () => {
    const res = await app.inject({ url: '/api/test/not-found' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Widget not found' });
  });

  it('hides unexpected errors behind a generic 500 and logs them', async () => {
    logLines.length = 0;

    const res = await app.inject({ url: '/api/test/crash' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal server error' });
    const logged = logLines.map((line) => JSON.parse(line) as Record<string, unknown>).find((l) => l['reqId']);
    expect(logged).toMatchObject({ level: 50 });
    expect(JSON.stringify(logged)).toContain('secret path /x');
    expect(logged?.['stack']).toEqual(expect.stringContaining('Error: secret path /x'));
  });

  it('answers schema validation failures with 400 { error }', async () => {
    const res = await app.inject({ url: '/api/test/validated' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.stringContaining('n') });
  });

  it('keeps the OpenAPI spec and docs behind auth', async () => {
    expect((await app.inject({ url: '/api/openapi.json' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/docs' })).statusCode).toBe(401);
  });

  it('generates an OpenAPI spec listing the key routes', () => {
    const spec = app.swagger() as {
      paths: Record<string, Record<string, { tags?: string[]; security?: unknown[] }>>;
      components: { securitySchemes: Record<string, { type: string; in?: string; scheme?: string }> };
    };

    expect(spec.paths['/api/workspaces']?.['get']?.tags).toEqual(['workspaces']);
    expect(spec.paths['/api/workspaces/{workspaceId}/sessions/{sessionId}/usage']?.['get']?.tags).toEqual(['sessions']);
    expect(spec.paths['/api/role-templates']?.['post']?.tags).toEqual(['role-templates']);
    expect(spec.paths['/api/auth/api-tokens']?.['post']?.tags).toEqual(['auth']);
    expect(spec.paths['/api/auth/login']?.['post']?.security).toEqual([]);
    expect(spec.paths['/api/health']?.['get']?.security).toEqual([]);
    expect(spec.paths['/api/mcp/nova']).toBeUndefined();
    expect(spec.components.securitySchemes['sessionCookie']).toMatchObject({ type: 'apiKey', in: 'cookie' });
    expect(spec.components.securitySchemes['apiKey']).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('answers unknown /api paths with 404 JSON', async () => {
    const res = await app.inject({ url: '/api/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found' });
  });
});

describe('buildApp with a dashboard dist', () => {
  let spaApp: FastifyInstance;
  let distDir: string;

  beforeAll(async () => {
    distDir = mkdtempSync(join(tmpdir(), 'nova-dist-'));
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>spa</title>');
    spaApp = await buildApp({ logger: false, dashboardDist: distDir });
    await spaApp.ready();
  });

  afterAll(async () => {
    await spaApp.close();
    rmSync(distDir, { recursive: true, force: true });
  });

  it('answers a missing asset with 404 JSON instead of index.html', async () => {
    const res = await spaApp.inject({ url: '/assets/missing-abc123.js?v=1' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found' });
  });

  it('falls back to index.html for client routes', async () => {
    const res = await spaApp.inject({ url: '/some/client/route?tab=1' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<title>spa</title>');
  });

  it('keeps JSON 404 for unknown /api paths', async () => {
    const res = await spaApp.inject({ url: '/api/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found' });
  });
});
