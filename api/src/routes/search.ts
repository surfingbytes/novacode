// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

// classes
import { jwtPreHandler } from '../classes/auth';
import { db } from '../classes/database';

const SearchResultSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  type: Type.Union([
    Type.Literal('workspace'),
    Type.Literal('session'),
    Type.Literal('role-template'),
    Type.Literal('automation')
  ]),
  workspaceId: Type.Optional(Type.String()),
  workspaceName: Type.Optional(Type.String())
});

const SearchResponseSchema = Type.Object({
  workspaces: Type.Array(SearchResultSchema),
  sessions: Type.Array(SearchResultSchema),
  roleTemplates: Type.Array(SearchResultSchema),
  automations: Type.Array(SearchResultSchema),
});

export async function searchRoutes(fastify: FastifyInstance): Promise<void> {
  // -------------------------------------------------- Setup --------------------------------------------------
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // -------------------------------------------------- Routes --------------------------------------------------
  // GET /api/search — search across all resources
  fastifyInstance.get(
    '/api/search',
    {
      preHandler: jwtPreHandler,
      schema: {
        querystring: Type.Object({
          query: Type.String({ minLength: 1 }),
        }),
        response: {
          200: SearchResponseSchema,
          400: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const { query } = request.query as { query: string };

      if (!query || query.trim().length === 0) {
        return reply.code(400).send({ error: 'Query parameter is required' });
      }

      const searchTerm = query.trim().toLowerCase();

      try {
        // ---------------------------------- Workspaces ----------------------------------
        const workspaces = await db.listWorkspaces({ includeArchived: false });
        const workspaceResults = workspaces
          .filter((workspace) => workspace.name.toLowerCase().includes(searchTerm))
          .map((workspace) => ({
            id: workspace.id,
            name: workspace.name,
            type: 'workspace' as const,
            workspaceId: workspace.id,
          }));

        // ---------------------------------- Sessions ----------------------------------
        const allWorkspaces = await db.listWorkspaces({ includeArchived: true });
        const sessionResults = [];

        for (const workspace of allWorkspaces) {
          const sessions = await db.listSessionsByWorkspace(workspace.id, { archived: false });
          const filteredSessions = sessions.filter((session) =>
            session.name.toLowerCase().includes(searchTerm),
          );

          sessionResults.push(
            ...filteredSessions.map((session) => ({
              id: session.id,
              name: session.name,
              type: 'session' as const,
              workspaceId: session.workspaceId,
              workspaceName: workspace.name,
            })),
          );
        }

        // ---------------------------------- Role Templates ----------------------------------
        const roleTemplates = await db.listRoleTemplates();
        const roleTemplateResults = roleTemplates
          .filter((roleTemplate) => roleTemplate.name.toLowerCase().includes(searchTerm))
          .map((roleTemplate) => ({
            id: roleTemplate.id,
            name: roleTemplate.name,
            type: 'role-template' as const,
          }));

        // ---------------------------------- Automations ----------------------------------
        const automations = await db.listAutomations();
        const automationResults = automations
          .filter((automation) => automation.name.toLowerCase().includes(searchTerm))
          .map((automation) => ({
            id: automation.id,
            name: automation.name,
            type: 'automation' as const,
          }));

        // ---------------------------------- Response ----------------------------------
        const response = {
          workspaces: workspaceResults,
          sessions: sessionResults,
          roleTemplates: roleTemplateResults,
          automations: automationResults,
        };

        return reply.send(response);
      } catch (error) {
        console.error('Search failed:', error);
        return reply.status(500).send({ error: 'Failed to perform search' });
      }
    },
  );
}