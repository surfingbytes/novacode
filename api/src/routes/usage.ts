// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { UsageOverviewQuerySchema, UsageOverviewSchema } from '@novacode/shared';

// classes
import { jwtPreHandler } from '../classes/auth';
import { db } from '../classes/database';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 366;

type UsageRange = { fromIso: string; toIso: string } | { error: string };

/** Resolve the optional `from`/`to` query into normalized ISO bounds, or a validation error. */
export function resolveUsageRange(from: string | undefined, to: string | undefined, now = new Date()): UsageRange {
  const toMs = to === undefined ? now.getTime() : Date.parse(to);
  if (Number.isNaN(toMs)) {
    return { error: 'Invalid "to" date' };
  }
  const fromMs = from === undefined ? toMs - DEFAULT_RANGE_DAYS * DAY_MS : Date.parse(from);
  if (Number.isNaN(fromMs)) {
    return { error: 'Invalid "from" date' };
  }
  if (fromMs > toMs) {
    return { error: '"from" must not be after "to"' };
  }
  if (toMs - fromMs > MAX_RANGE_DAYS * DAY_MS) {
    return { error: `Range must not exceed ${MAX_RANGE_DAYS} days` };
  }
  return { fromIso: new Date(fromMs).toISOString(), toIso: new Date(toMs).toISOString() };
}

export async function usageRoutes(fastify: FastifyInstance): Promise<void> {
  // -------------------------------------------------- Setup --------------------------------------------------
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // -------------------------------------------------- Routes --------------------------------------------------
  // GET /api/usage/overview — token/cost usage across all workspaces, grouped
  fastifyInstance.get(
    '/api/usage/overview',
    {
      preHandler: jwtPreHandler,
      schema: {
        querystring: UsageOverviewQuerySchema,
        response: {
          200: UsageOverviewSchema,
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const range = resolveUsageRange(request.query.from, request.query.to);
      if ('error' in range) {
        return reply.code(400).send({ error: range.error });
      }
      return db.summarizeUsageOverview(range.fromIso, range.toIso);
    }
  );
}
