// node_modules
import type { FastifyInstance } from 'fastify';

// classes
import { genericErrorMessage, HttpError } from './httpErrors';

/**
 * HttpError → its status and message (generic message when not exposed); Fastify's own 4xx
 * errors (schema validation, body limits, rate limit) keep their status; anything else is
 * logged and answered with a generic 500.
 */
export function registerErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler((err: unknown, request, reply) => {
    if (err instanceof HttpError) {
      if (err.statusCode >= 500) {
        request.log.error({ err, reqId: request.id }, 'Request failed');
      }
      return reply.code(err.statusCode).send({ error: err.expose ? err.message : genericErrorMessage(err.statusCode) });
    }

    const error = err instanceof Error ? (err as Error & { statusCode?: unknown }) : null;
    const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : 500;
    if (error && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: error.message });
    }

    request.log.error(
      { err, reqId: request.id, stack: error?.stack },
      `Unhandled error on ${request.method} ${request.routeOptions.url ?? request.url}`
    );
    return reply.code(500).send({ error: 'Internal server error' });
  });
}
