/**
 * API-local type barrel. Canonical types live in @novacode/shared
 * (shared/src/types.ts) — this module re-exports them so existing
 * `../@types/index` imports keep working, and adds Fastify augmentation.
 */

// node_modules
import type { FastifyRequest, FastifyReply } from 'fastify';

// --------------------------------------------- Types ---------------------------------------------

export * from '@novacode/shared';

// Fastify module augmentation
declare module 'fastify' {
  interface FastifyInstance {
    verifyJwt: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    jwtUser: { id: string; username: string } | null;
  }
}
