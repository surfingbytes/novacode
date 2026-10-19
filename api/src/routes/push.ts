// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

// classes
import { jwtPreHandler } from '../classes/auth';
import { db } from '../classes/database';
import { getVapidPublicKey, isPushConfigured } from '../classes/push';

const PushSubscriptionSchema = Type.Object({
  endpoint: Type.String({ minLength: 1 }),
  keys: Type.Object({
    p256dh: Type.String({ minLength: 1 }),
    auth: Type.String({ minLength: 1 })
  }),
  /** Per-device notification preferences; omitted = keep stored values. */
  notifyTasks: Type.Optional(Type.Boolean()),
  notifyCi: Type.Optional(Type.Boolean())
});

export async function pushRoutes(fastify: FastifyInstance): Promise<void> {
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  fastifyInstance.get(
    '/api/push/public-key',
    {
      preHandler: jwtPreHandler,
      schema: {
        response: {
          200: Type.Object({
            enabled: Type.Boolean(),
            publicKey: Type.Union([Type.String(), Type.Null()])
          })
        }
      }
    },
    async () => {
      const publicKey = getVapidPublicKey();
      return { enabled: isPushConfigured(), publicKey };
    }
  );

  fastifyInstance.post(
    '/api/push/subscribe',
    {
      preHandler: jwtPreHandler,
      schema: {
        body: PushSubscriptionSchema,
        response: {
          201: Type.Object({ ok: Type.Boolean() })
        }
      }
    },
    async (request, reply) => {
      const body = request.body as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
        notifyTasks?: boolean;
        notifyCi?: boolean;
      };
      await db.upsertPushSubscription({
        userId: request.jwtUser!.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        notifyTasks: body.notifyTasks,
        notifyCi: body.notifyCi
      });
      return reply.code(201).send({ ok: true });
    }
  );

  fastifyInstance.post(
    '/api/push/unsubscribe',
    {
      preHandler: jwtPreHandler,
      schema: {
        body: Type.Object({ endpoint: Type.String({ minLength: 1 }) }),
        response: {
          200: Type.Object({ ok: Type.Boolean() })
        }
      }
    },
    async (request) => {
      const { endpoint } = request.body as { endpoint: string };
      await db.deletePushSubscriptionByEndpoint(endpoint);
      return { ok: true };
    }
  );
}
