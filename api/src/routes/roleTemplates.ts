// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

// classes
import { jwtPreHandler } from '../classes/auth';
import { db } from '../classes/database';

const TemplateParamsSchema = Type.Object({ templateId: Type.String() });
const TemplateBodySchema = Type.Object({
  name: Type.Optional(Type.String()),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  content: Type.Optional(Type.String())
});

export async function roleTemplateRoutes(fastify: FastifyInstance): Promise<void> {
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // GET /api/role-templates
  fastifyInstance.get(
    '/api/role-templates',
    { preHandler: jwtPreHandler },
    async (_request, reply) => {
      const templates = await db.listRoleTemplates();
      return reply.send(templates);
    }
  );

  // POST /api/role-templates
  fastifyInstance.post(
    '/api/role-templates',
    { preHandler: jwtPreHandler, schema: { body: TemplateBodySchema } },
    async (request, reply) => {
      const body = request.body;

      const name = body.name?.trim();
      if (!name) {
        return reply.status(400).send({ error: 'name is required' });
      }
      const content = body.content;
      if (!content || typeof content !== 'string' || !content.trim()) {
        return reply.status(400).send({ error: 'content is required' });
      }

      const existing = await db.findRoleTemplateByName(name);
      if (existing) {
        return reply
          .status(409)
          .send({ error: 'Role template name already exists' });
      }

      const created = await db.createRoleTemplate({
        name,
        description: body.description ?? null,
        content
      });

      return reply.status(201).send(created);
    }
  );

  // PATCH /api/role-templates/:templateId
  fastifyInstance.patch(
    '/api/role-templates/:templateId',
    { preHandler: jwtPreHandler, schema: { params: TemplateParamsSchema, body: TemplateBodySchema } },
    async (request, reply) => {
      const { templateId } = request.params;

      const existing = await db.getRoleTemplate(templateId);
      if (!existing) {
        return reply.status(404).send({ error: 'Role template not found' });
      }

      const body = request.body;

      if (body.name !== undefined) {
        const trimmedName = body.name.trim();
        if (!trimmedName) {
          return reply.status(400).send({ error: 'name cannot be empty' });
        }
        if (trimmedName !== existing.name) {
          const conflict = await db.findRoleTemplateByName(trimmedName);
          if (conflict && conflict.id !== templateId) {
            return reply
              .status(409)
              .send({ error: 'Role template name already exists' });
          }
        }
      }

      if (body.content !== undefined) {
        if (!body.content || !String(body.content).trim()) {
          return reply.status(400).send({ error: 'content cannot be empty' });
        }
      }

      const updated = await db.updateRoleTemplate(templateId, {
        name: body.name,
        description: body.description,
        content: body.content
      });

      if (!updated) {
        return reply.status(500).send({ error: 'Failed to update role template' });
      }

      return reply.send(updated);
    }
  );

  // DELETE /api/role-templates/:templateId
  fastifyInstance.delete(
    '/api/role-templates/:templateId',
    { preHandler: jwtPreHandler, schema: { params: TemplateParamsSchema } },
    async (request, reply) => {
      const { templateId } = request.params;

      const existing = await db.getRoleTemplate(templateId);
      if (!existing) {
        return reply.status(404).send({ error: 'Role template not found' });
      }

      const success = await db.deleteRoleTemplate(templateId);
      if (!success) {
        return reply.status(500).send({ error: 'Failed to delete role template' });
      }

      return reply.status(204).send();
    }
  );
}
