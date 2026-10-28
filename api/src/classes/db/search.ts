// classes
import { messageSearchText, sessionMessageRowToChat } from '../sessionMessages';
import { prisma } from './client';
import { SEARCH_LIMIT, ilikeContains } from './shared';

// --------------------------------------------- Search ---------------------------------------------

export type SearchHit = {
  id: string;
  name: string;
  type: 'workspace' | 'session' | 'orchestrator' | 'role-template' | 'automation';
  workspaceId?: string;
  workspaceName?: string;
  /** Last activity (ISO), shown next to the hit. */
  updatedAt?: string;
};

/** Fill `search_text` for messages persisted before the column existed. Returns rows updated. */
export async function backfillSessionMessageSearchText(): Promise<number> {
  // events_json can be many MB per row (tool output), so keep batches small
  const BATCH = 25;
  let updated = 0;
  for (;;) {
    const rows = await prisma.sessionMessage.findMany({
      where: { searchText: null },
      select: {
        id: true,
        role: true,
        content: true,
        eventsJson: true,
        imagePathsJson: true,
        createdAt: true
      },
      take: BATCH
    });
    if (rows.length === 0) return updated;
    await prisma.$transaction(
      rows.map((row) =>
        prisma.sessionMessage.updateMany({
          where: { id: row.id },
          data: {
            searchText: messageSearchText(sessionMessageRowToChat(row))
          }
        })
      )
    );
    updated += rows.length;
  }
}

export async function searchCatalog(query: string): Promise<{
  workspaces: SearchHit[];
  sessions: SearchHit[];
  orchestrators: SearchHit[];
  roleTemplates: SearchHit[];
  automations: SearchHit[];
}> {
  const contains = ilikeContains(query.trim());

  const [workspaces, sessions, orchestrators, roleTemplates, automations] = await Promise.all([
    prisma.workspace.findMany({
      where: { archived: false, name: contains },
      select: { id: true, name: true },
      take: SEARCH_LIMIT,
      orderBy: { name: 'asc' }
    }),
    prisma.session.findMany({
      where: {
        archived: false,
        OR: [
          { name: contains },
          { lastPreviewText: contains },
          { messages: { some: { OR: [{ content: contains }, { searchText: contains }] } } }
        ]
      },
      select: {
        id: true,
        name: true,
        lastPreviewText: true,
        updatedAt: true,
        workspaceId: true,
        workspace: { select: { name: true } }
      },
      take: SEARCH_LIMIT,
      orderBy: { updatedAt: 'desc' }
    }),
    prisma.orchestrator.findMany({
      where: {
        archived: false,
        OR: [{ name: contains }, { messageJson: contains }, { tags: contains }]
      },
      select: {
        id: true,
        name: true,
        updatedAt: true,
        workspaceId: true,
        workspace: { select: { name: true } }
      },
      take: SEARCH_LIMIT,
      orderBy: { updatedAt: 'desc' }
    }),
    prisma.roleTemplate.findMany({
      where: { OR: [{ name: contains }, { content: contains }] },
      select: { id: true, name: true },
      take: SEARCH_LIMIT,
      orderBy: { name: 'asc' }
    }),
    prisma.automation.findMany({
      where: { OR: [{ name: contains }, { prompt: contains }] },
      select: {
        id: true,
        name: true,
        updatedAt: true,
        lastRunAt: true,
        workspaceId: true,
        workspace: { select: { name: true } }
      },
      take: SEARCH_LIMIT,
      orderBy: { name: 'asc' }
    })
  ]);

  return {
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      type: 'workspace' as const,
      workspaceId: workspace.id
    })),
    sessions: sessions.map((session) => {
      const name = session.name?.trim() ?? '';
      const preview = session.lastPreviewText?.trim() ?? '';
      return {
        id: session.id,
        name: name || preview || 'Untitled session',
        type: 'session' as const,
        workspaceId: session.workspaceId,
        workspaceName: session.workspace.name,
        updatedAt: session.updatedAt
      };
    }),
    orchestrators: orchestrators.map((orchestrator) => ({
      id: orchestrator.id,
      name: orchestrator.name?.trim() || 'Untitled orchestrator',
      type: 'orchestrator' as const,
      workspaceId: orchestrator.workspaceId,
      workspaceName: orchestrator.workspace.name,
      updatedAt: orchestrator.updatedAt
    })),
    roleTemplates: roleTemplates.map((roleTemplate) => ({
      id: roleTemplate.id,
      name: roleTemplate.name,
      type: 'role-template' as const
    })),
    automations: automations.map((automation) => ({
      id: automation.id,
      name: automation.name,
      type: 'automation' as const,
      workspaceId: automation.workspaceId,
      workspaceName: automation.workspace.name,
      updatedAt: automation.lastRunAt ?? automation.updatedAt
    }))
  };
}

export const searchDb = {
  backfillSessionMessageSearchText,
  searchCatalog
};
