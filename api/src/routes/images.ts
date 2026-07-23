// node_modules
import type { FastifyInstance } from 'fastify';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { existsSync } from 'node:fs';

// classes
import { jwtPreHandler, verifyToken } from '../classes/auth';
import { db } from '../classes/database';
import { config } from '../classes/config';

// --------------------------------------------- Config ---------------------------------------------

const IMAGE_DIR = join(config.configDir, 'prompt-images');

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/json': '.json',
  'application/pdf': '.pdf',
  'text/csv': '.csv',
  'text/html': '.html',
  'text/css': '.css',
  'text/javascript': '.js',
  'application/javascript': '.js',
  'application/typescript': '.ts',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'application/yaml': '.yaml',
  'text/yaml': '.yaml',
  'application/x-yaml': '.yaml',
};

const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.ts': 'application/typescript',
  '.tsx': 'application/typescript',
  '.jsx': 'text/javascript',
  '.vue': 'text/plain',
  '.py': 'text/plain',
  '.sh': 'text/plain',
  '.bash': 'text/plain',
  '.zsh': 'text/plain',
  '.sql': 'text/plain',
  '.log': 'text/plain',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.xml': 'application/xml',
  '.toml': 'text/plain',
  '.ini': 'text/plain',
  '.env': 'text/plain',
};

const ALLOWED_EXTENSIONS = new Set(Object.keys(EXT_TO_CONTENT_TYPE));

function resolveExtension(mimeType: string, filename?: string): string | null {
  const fromName = filename ? extname(filename).toLowerCase() : '';
  if (fromName && ALLOWED_EXTENSIONS.has(fromName)) {
    return fromName;
  }
  const fromMime = MIME_TO_EXT[mimeType];
  if (fromMime) {
    return fromMime;
  }
  return null;
}

// --------------------------------------------- Helpers ---------------------------------------------

export async function deleteSessionImages(sessionId: string): Promise<void> {
  const dir = join(IMAGE_DIR, sessionId);
  // guard: only delete inside IMAGE_DIR
  if (!dir.startsWith(IMAGE_DIR + '/')) return;
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // non-critical — ignore if directory doesn't exist
  }
}

// --------------------------------------------- Routes ---------------------------------------------

export async function imageRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/sessions/:sessionId/images — upload a base64-encoded attachment.
  // Route-level bodyLimit: much larger than the global cap so videos fit (see config).
  fastify.post(
    '/api/sessions/:sessionId/images',
    { preHandler: jwtPreHandler, bodyLimit: config.uploadBodyLimitBytes },
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      const body = request.body as { data: string; mimeType: string; filename?: string };

      const session = await db.getSession(sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const ext = resolveExtension(body.mimeType, body.filename);
      if (!ext) {
        return reply.status(400).send({ error: 'Unsupported file type' });
      }

      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      const dir = join(IMAGE_DIR, sessionId);

      if (!dir.startsWith(IMAGE_DIR + '/')) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      await mkdir(dir, { recursive: true });

      const buf = Buffer.from(body.data, 'base64');
      const filePath = join(dir, filename);
      await writeFile(filePath, buf);

      return reply.status(201).send({ path: filePath, filename });
    }
  );

  // GET /api/sessions/:sessionId/images/:filename — serve an uploaded image
  // Accepts token as query param so <img> tags can load authenticated images.
  fastify.get(
    '/api/sessions/:sessionId/images/:filename',
    async (request, reply) => {
      const query = request.query as Record<string, string>;
      const token = query['token'] ?? (request.headers['authorization'] ?? '').replace(/^Bearer /, '');
      try {
        await verifyToken(token);
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const { sessionId, filename } = request.params as {
        sessionId: string;
        filename: string;
      };

      const dir = join(IMAGE_DIR, sessionId);
      if (!dir.startsWith(IMAGE_DIR + '/')) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      // prevent path traversal via filename
      const safeName = basename(filename);
      const filePath = join(dir, safeName);
      if (!filePath.startsWith(dir + '/')) {
        return reply.status(400).send({ error: 'Invalid filename' });
      }

      if (!existsSync(filePath)) {
        return reply.status(404).send({ error: 'Image not found' });
      }

      const contentType = EXT_TO_CONTENT_TYPE[extname(safeName).toLowerCase()] ?? 'application/octet-stream';
      const data = await readFile(filePath);
      return reply.header('Content-Type', contentType).send(data);
    }
  );
}
