import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Mock factories run before static imports, so load node modules dynamically here.
vi.mock('../classes/sessionImages', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  return { IMAGE_DIR: mkdtempSync(path.join(tmpdir(), 'nova-images-route-')) };
});

vi.mock('../classes/database', () => ({
  db: { getSession: async (id: string): Promise<{ id: string } | null> => (id === 'up' ? { id } : null) }
}));

vi.mock('../classes/auth', () => ({
  jwtPreHandler: async (): Promise<void> => {},
  extractRequestToken: (request: { headers: Record<string, string | undefined> }): string | null =>
    request.headers['authorization']?.replace(/^Bearer /, '') ?? null,
  authenticateToken: async (token: string): Promise<{ id: string } | null> =>
    token === 'good' ? { id: 'u1' } : null
}));

import { attachmentHeadersFor, imageRoutes } from './images';
import { registerErrorHandler } from '../classes/errorHandler';
import { IMAGE_DIR as imageDir } from '../classes/sessionImages';

let app: FastifyInstance;

beforeAll(async () => {
  const sessionDir = join(imageDir, 's1');
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, 'page.html'), '<script src="x.js"></script>');
  await writeFile(join(sessionDir, 'x.js'), 'alert(1)');
  await writeFile(join(sessionDir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  app = Fastify();
  registerErrorHandler(app);
  await app.register(imageRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(imageDir, { recursive: true, force: true });
});

const get = (filename: string, auth = true): Promise<LightMyRequestResponse> =>
  app.inject({
    method: 'GET',
    url: `/api/sessions/s1/images/${filename}`,
    headers: auth ? { authorization: 'Bearer good' } : {}
  });

describe('attachmentHeadersFor', () => {
  it('forces download + sandbox for non-allowlisted types', () => {
    for (const name of ['a.html', 'a.htm', 'a.css', 'a.xml', 'a.yaml', 'a.eml', 'a.zip', 'a.unknownext', 'a.svg']) {
      const { headers } = attachmentHeadersFor(name);
      expect(headers['Content-Disposition']).toBe(`attachment; filename="${name}"`);
      expect(headers['Content-Security-Policy']).toBe('sandbox');
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
    }
    expect(attachmentHeadersFor('a.unknownext').contentType).toBe('application/octet-stream');
  });

  it('serves script sources as text/plain inline', () => {
    for (const name of ['a.js', 'a.mjs', 'a.jsx', 'a.ts', 'a.TSX']) {
      const { contentType, headers } = attachmentHeadersFor(name);
      expect(contentType).toBe('text/plain');
      expect(headers['Content-Disposition']).toBeUndefined();
    }
  });

  it('serves allowlisted types inline', () => {
    const { contentType, headers } = attachmentHeadersFor('doc.pdf');
    expect(contentType).toBe('application/pdf');
    expect(headers).toEqual({ 'X-Content-Type-Options': 'nosniff' });
  });

  it('sanitizes quotes and non-ASCII in the download filename', () => {
    const { headers } = attachmentHeadersFor('a"b\\cž.html');
    expect(headers['Content-Disposition']).toBe('attachment; filename="a_b_c_.html"');
  });
});

describe('GET /api/sessions/:sessionId/images/:filename', () => {
  it('serves .html as a sandboxed attachment', async () => {
    const res = await get('page.html');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-disposition']).toBe('attachment; filename="page.html"');
    expect(res.headers['content-security-policy']).toBe('sandbox');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves .js as text/plain with nosniff', async () => {
    const res = await get('x.js');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('serves .png inline as image/png', async () => {
    const res = await get('pic.png');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('answers 401 without auth', async () => {
    const res = await get('pic.png', false);
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/sessions/:sessionId/images', () => {
  const upload = (payload: Record<string, unknown>): Promise<LightMyRequestResponse> =>
    app.inject({ method: 'POST', url: '/api/sessions/up/images', payload });

  it('answers 400 when data is missing', async () => {
    const res = await upload({ mimeType: 'image/png', filename: 'a.png' });

    expect(res.statusCode).toBe(400);
  });

  it('keeps every parallel upload with the same name', async () => {
    const bodies = Array.from({ length: 8 }, (_, i) => `file-${i}`);

    const results = await Promise.all(
      bodies.map((text) =>
        upload({ data: Buffer.from(text).toString('base64'), mimeType: 'text/plain', filename: 'same.txt' })
      )
    );

    expect(results.map((r) => r.statusCode)).toEqual(bodies.map(() => 201));
    const names = results.map((r) => r.json().filename as string);
    expect(new Set(names).size).toBe(bodies.length);
    const dir = join(imageDir, 'up');
    expect((await readdir(dir)).sort()).toEqual([...names].sort());
    const contents = await Promise.all(names.map((n) => readFile(join(dir, n), 'utf8')));
    expect(contents.sort()).toEqual([...bodies].sort());
  });
});
