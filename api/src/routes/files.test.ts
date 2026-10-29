import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const getWorkspace = vi.fn();

vi.mock('../classes/database', () => ({
  db: {
    getWorkspace: (...args: unknown[]) => getWorkspace(...args)
  }
}));

vi.mock('../classes/auth', () => ({
  jwtPreHandler: async (): Promise<void> => {},
  extractRequestToken: (request: { headers: Record<string, string | undefined> }): string | null =>
    request.headers['authorization']?.replace(/^Bearer /, '') ?? null,
  authenticateToken: async (token: string): Promise<{ id: string } | null> =>
    token === 'good' ? { id: 'u1' } : null
}));

vi.mock('../classes/workspacePaths', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../classes/workspacePaths')>()),
  // Workspace rows in these tests store the absolute temp path.
  resolveWorkspaceAbsolutePath: (path: string): string => path
}));

import { MAX_FILE_READ_BYTES } from '../classes/workspaceFs';
import { fileRoutes } from './files';
import { registerErrorHandler } from '../classes/errorHandler';

let tempRoot: string;
let workspace: string;
let outside: string;
let app: FastifyInstance;

beforeAll(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'nova-files-route-'));
  workspace = join(tempRoot, 'ws');
  outside = join(tempRoot, 'outside');
  await mkdir(join(workspace, 'src', 'nested'), { recursive: true });
  await mkdir(outside);
  await writeFile(join(workspace, 'src', 'nested', 'a.txt'), 'hello');
  await writeFile(join(outside, 'secret.txt'), 'secret');
  await symlink(outside, join(workspace, 'escape'));
  await symlink(join(outside, 'secret.txt'), join(workspace, 'secret-link.txt'));
  await symlink(join(outside, 'missing.txt'), join(workspace, 'dangling.txt'));

  app = Fastify();
  registerErrorHandler(app);
  await app.register(fileRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(tempRoot, { recursive: true, force: true });
});

beforeEach(() => {
  getWorkspace.mockResolvedValue({ id: 'w1', path: workspace });
});

const url = (suffix: string): string => `/api/workspaces/w1/files${suffix}`;

describe('file routes — symlink escapes', () => {
  it('reads and writes normal nested paths', async () => {
    const read = await app.inject({ method: 'GET', url: url('/read?path=src/nested/a.txt') });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ content: 'hello', encoding: 'utf8' });

    const write = await app.inject({
      method: 'PUT',
      url: url('/write'),
      payload: { path: 'src/new/b.txt', content: 'b' }
    });
    expect(write.statusCode).toBe(200);
    expect(await readFile(join(workspace, 'src', 'new', 'b.txt'), 'utf8')).toBe('b');
  });

  it('rejects reading through a symlink that leaves the workspace', async () => {
    const viaDir = await app.inject({ method: 'GET', url: url('/read?path=escape/secret.txt') });
    expect(viaDir.statusCode).toBe(403);
    const viaFile = await app.inject({ method: 'GET', url: url('/read?path=secret-link.txt') });
    expect(viaFile.statusCode).toBe(403);
    const list = await app.inject({ method: 'GET', url: url('/list?path=escape') });
    expect(list.statusCode).toBe(403);
  });

  it('rejects writing, creating and renaming through an escaping symlink', async () => {
    const write = await app.inject({
      method: 'PUT',
      url: url('/write'),
      payload: { path: 'escape/new.txt', content: 'x' }
    });
    expect(write.statusCode).toBe(403);
    const dangling = await app.inject({
      method: 'PUT',
      url: url('/write'),
      payload: { path: 'dangling.txt', content: 'x' }
    });
    expect(dangling.statusCode).toBe(403);
    const mkdirRes = await app.inject({ method: 'POST', url: url('/mkdir'), payload: { path: 'escape/sub/dir' } });
    expect(mkdirRes.statusCode).toBe(403);
    const renameRes = await app.inject({
      method: 'POST',
      url: url('/rename'),
      payload: { from: 'src/nested/a.txt', to: 'escape/a.txt' }
    });
    expect(renameRes.statusCode).toBe(403);
    expect(existsSync(join(outside, 'new.txt'))).toBe(false);
    expect(existsSync(join(outside, 'missing.txt'))).toBe(false);
    expect(existsSync(join(outside, 'sub'))).toBe(false);
    expect(existsSync(join(outside, 'a.txt'))).toBe(false);
  });

  it('rejects deleting through an escaping symlink', async () => {
    const res = await app.inject({ method: 'DELETE', url: url('?path=escape/secret.txt') });
    expect(res.statusCode).toBe(403);
    expect(existsSync(join(outside, 'secret.txt'))).toBe(true);
  });

  it('still rejects lexical traversal with 400', async () => {
    const res = await app.inject({ method: 'GET', url: url('/read?path=../outside/secret.txt') });
    expect(res.statusCode).toBe(400);
  });
});

describe('file routes — read size limit', () => {
  it('answers 413 for files above MAX_FILE_READ_BYTES', async () => {
    const big = join(workspace, 'big.bin');
    await writeFile(big, '');
    await truncate(big, MAX_FILE_READ_BYTES + 1);
    const res = await app.inject({ method: 'GET', url: url('/read?path=big.bin') });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: 'File too large' });
  });

  it('reads a file exactly at the limit', async () => {
    const edge = join(workspace, 'edge.txt');
    await writeFile(edge, 'a'.repeat(MAX_FILE_READ_BYTES));
    const res = await app.inject({ method: 'GET', url: url('/read?path=edge.txt') });
    expect(res.statusCode).toBe(200);
  });
});

describe('tool-image auth', () => {
  it('ignores a ?token= query and accepts Bearer', async () => {
    const viaQuery = await app.inject({ method: 'GET', url: '/api/files/tool-image?path=/nope.png&token=good' });
    expect(viaQuery.statusCode).toBe(401);
    const viaBearer = await app.inject({
      method: 'GET',
      url: '/api/files/tool-image?path=/nope.png',
      headers: { authorization: 'Bearer good' }
    });
    expect(viaBearer.statusCode).not.toBe(401);
  });
});
