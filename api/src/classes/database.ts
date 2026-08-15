// node_modules
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// classes/api
import { ensureDatabaseUrl } from '../env';
import { PrismaClient, Prisma } from '../generated/client/client';
import { config } from './config';
import { computeLastListPreview } from './chatPreview';
import {
  chatMessageToRowData,
  escapeIlikeContains,
  sessionMessageRowToChat
} from './sessionMessages';
import { hashApiToken, MAX_API_TOKENS_PER_USER } from './apiTokens';
import { serializeSessionUsage } from './sessionUsage';
import { logger } from './logger';

ensureDatabaseUrl();

// types
import type { WorkspaceModel as Workspace } from '../generated/client/models/Workspace';
import type { SessionModel as Session } from '../generated/client/models/Session';
import type { OrchestratorModel as Orchestrator } from '../generated/client/models/Orchestrator';
import type { RoleTemplateModel as RoleTemplate } from '../generated/client/models/RoleTemplate';
import type { AutomationModel as Automation } from '../generated/client/models/Automation';
import type { AutomationRunModel as AutomationRun } from '../generated/client/models/AutomationRun';
import type { UserModel } from '../generated/client/models';
import type { PushSubscriptionModel as PushSubscription } from '../generated/client/models/PushSubscription';
import type { ChatMessage, ChatQueueItem, SessionUsageSnapshot, SessionUsageTurn, WorkspaceUsageSummary } from '../@types/index';
import { MAX_FAVORITE_WORKSPACES } from '@novacode/shared';

/** Session list/detail row (chat history lives in `session_messages`). */
export type SessionWithCategory = Session;
/** Session with all fields */
export type SessionWithCategoryAndMessages = Session;
/** Orchestrator (alias for backward compat) */
export type OrchestratorWithCategory = Orchestrator;

export class FavoriteLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FavoriteLimitError';
  }
}

// --------------------------------------------- Setup ---------------------------------------------

function getDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is not set (ensureDatabaseUrl should run first)');
  }
  return url;
}

const pool = new Pool({ connectionString: getDatabaseUrl() });
const adapter = new PrismaPg(pool);
const _prisma = new PrismaClient({ adapter });

/** Dedupe (case-insensitive), trim; used for workspace and session tag arrays. */
export function normalizeTagStringList(tags: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of tags) {
    if (typeof x !== 'string') {
      continue;
    }
    const t = x.trim();
    if (!t) {
      continue;
    }
    const k = t.toLowerCase();
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(t);
  }
  return out;
}

function toChatQueueItem(row: {
  id: string;
  sessionId: string;
  text: string;
  model: string;
  mode: string;
  imagePaths: string | null;
  createdAt: string;
}): ChatQueueItem {
  return {
    id: row.id,
    sessionId: row.sessionId,
    text: row.text,
    model: row.model,
    mode: row.mode,
    imagePaths: row.imagePaths ? (JSON.parse(row.imagePaths) as string[]) : undefined,
    createdAt: row.createdAt
  };
}

export const SEARCH_LIMIT = 30;
const API_TOKEN_TOUCH_INTERVAL_MS = 60_000;
const apiTokenTouchedAt = new Map<string, number>();

export type SearchHit = {
  id: string;
  name: string;
  type: 'workspace' | 'session' | 'orchestrator' | 'role-template' | 'automation';
  workspaceId?: string;
  workspaceName?: string;
};

function ilikeContains(term: string): { contains: string; mode: 'insensitive' } {
  return { contains: escapeIlikeContains(term), mode: 'insensitive' };
}

async function summarizeUsageWhere(
  where: { workspaceId: string } | { sessionId: string }
): Promise<WorkspaceUsageSummary> {
  const aggregate = await _prisma.sessionUsage.aggregate({
    where,
    _count: { id: true },
    _sum: { used: true, size: true, costAmount: true }
  });
  const withCurrency = await _prisma.sessionUsage.findFirst({
    where: { ...where, costCurrency: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { costCurrency: true }
  });
  return {
    turnCount: aggregate._count.id,
    used: aggregate._sum.used ?? 0,
    size: aggregate._sum.size ?? 0,
    costAmount: aggregate._sum.costAmount ?? null,
    costCurrency: withCurrency?.costCurrency ?? null
  };
}

export const db = {
  // -------------------------------------------------- Health --------------------------------------------------

  async pingDatabase(): Promise<void> {
    await _prisma.$queryRaw`SELECT 1`;
  },

  // -------------------------------------------------- Auth --------------------------------------------------

  async hasAnyUser(): Promise<boolean> {
    const count = await _prisma.user.count();
    return count > 0;
  },

  async getUserByUsername(username: string): Promise<UserModel | null> {
    return _prisma.user.findUnique({ where: { username } });
  },

  async getUserById(id: string): Promise<UserModel | null> {
    return _prisma.user.findUnique({ where: { id } });
  },

  async getFirstUser(): Promise<UserModel | null> {
    return _prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  },

  async listUsers(): Promise<UserModel[]> {
    return _prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  },

  async createUser(username: string, passwordHash: string): Promise<UserModel> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    return _prisma.user.create({ data: { id, username, passwordHash, createdAt } });
  },

  async updateUser(
    id: string,
    patch: {
      username?: string;
      passwordHash?: string;
      gitUserName?: string | null;
      gitUserEmail?: string | null;
      theme?: string;
      autoTheme?: boolean;
      darkTheme?: string;
      lightTheme?: string;
      modelSelection?: string;
      claudeToken?: string | null;
    }
  ): Promise<UserModel | undefined> {
    const existingUser = await _prisma.user.findUnique({ where: { id } });
    if (!existingUser) {
      return undefined;
    }
    return _prisma.user.update({ where: { id }, data: patch });
  },

  async getUserByApiToken(token: string): Promise<UserModel | null> {
    const tokenHash = hashApiToken(token);
    const row = await _prisma.apiToken.findUnique({
      where: { tokenHash },
      include: { user: true }
    });
    if (!row) {
      return null;
    }
    const now = Date.now();
    const previous = apiTokenTouchedAt.get(row.id) ?? 0;
    if (now - previous >= API_TOKEN_TOUCH_INTERVAL_MS) {
      apiTokenTouchedAt.set(row.id, now);
      void _prisma.apiToken
        .update({ where: { id: row.id }, data: { lastUsedAt: new Date().toISOString() } })
        .catch((err) => logger.warn({ err, tokenId: row.id }, 'Failed to update API token lastUsedAt'));
    }
    return row.user;
  },

  async listApiTokens(userId: string): Promise<
    Array<{ id: string; name: string; tokenPrefix: string; createdAt: string; lastUsedAt: string | null }>
  > {
    return _prisma.apiToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, tokenPrefix: true, createdAt: true, lastUsedAt: true }
    });
  },

  async countApiTokens(userId: string): Promise<number> {
    return _prisma.apiToken.count({ where: { userId } });
  },

  async createApiToken(data: {
    userId: string;
    name: string;
    tokenHash: string;
    tokenPrefix: string;
  }): Promise<{ id: string; name: string; tokenPrefix: string; createdAt: string; lastUsedAt: string | null }> {
    const count = await _prisma.apiToken.count({ where: { userId: data.userId } });
    if (count >= MAX_API_TOKENS_PER_USER) {
      throw new Error(`At most ${MAX_API_TOKENS_PER_USER} API keys are allowed`);
    }
    const createdAt = new Date().toISOString();
    return _prisma.apiToken.create({
      data: {
        id: randomUUID(),
        userId: data.userId,
        name: data.name,
        tokenHash: data.tokenHash,
        tokenPrefix: data.tokenPrefix,
        createdAt
      },
      select: { id: true, name: true, tokenPrefix: true, createdAt: true, lastUsedAt: true }
    });
  },

  async deleteApiToken(userId: string, tokenId: string): Promise<boolean> {
    const result = await _prisma.apiToken.deleteMany({ where: { id: tokenId, userId } });
    return result.count > 0;
  },

  // -------------------------------------------------- Workspaces --------------------------------------------------

  async listWorkspaces(opts?: { includeArchived?: boolean }): Promise<Workspace[]> {
    const rows = await _prisma.workspace.findMany({
      where: opts?.includeArchived ? undefined : { archived: false },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
    });
    return rows;
  },

  async getWorkspace(id: string): Promise<Workspace | undefined> {
    const row = await _prisma.workspace.findUnique({ where: { id } });
    return row ?? undefined;
  },

  async createWorkspace(data: {
    name: string;
    path: string;
    group?: string | null;
    gitUserName?: string | null;
    gitUserEmail?: string | null;
    color?: string | null;
    defaultAgentType?: string | null;
    tags?: string[] | null;
  }): Promise<Workspace> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const maxSort = await _prisma.workspace.aggregate({ _max: { sortOrder: true } });
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
    const tagsArr =
      data.tags != null && Array.isArray(data.tags)
        ? normalizeTagStringList(data.tags)
        : null;
    const tagsJson =
      tagsArr !== null && tagsArr.length > 0 ? tagsArr : Prisma.JsonNull;
    const row = await _prisma.workspace.create({
      data: {
        id,
        name: data.name,
        path: data.path,
        group: data.group?.trim() || null,
        createdAt,
        gitUserName: data.gitUserName ?? null,
        gitUserEmail: data.gitUserEmail ?? null,
        color: data.color ?? null,
        sortOrder,
        defaultAgentType: data.defaultAgentType ?? null,
        tags: tagsJson
      }
    });
    return row;
  },

  async updateWorkspace(
    id: string,
    patch: {
      name?: string;
      path?: string;
      group?: string | null;
      gitUserName?: string | null;
      gitUserEmail?: string | null;
      color?: string | null;
      defaultAgentType?: string | null;
      tags?: string[] | null;
      isFavorite?: boolean;
    }
  ): Promise<Workspace | undefined> {
    const existingWorkspace = await db.getWorkspace(id);
    if (!existingWorkspace) {
      return undefined;
    }
    const tagsArr =
      patch.tags !== undefined
        ? Array.isArray(patch.tags)
          ? normalizeTagStringList(patch.tags)
          : null
        : undefined;
    const tagsJson =
      tagsArr === undefined
        ? undefined
        : tagsArr === null || tagsArr.length === 0
          ? Prisma.JsonNull
          : tagsArr;

    let favoritePatch: { isFavorite?: boolean; favoriteOrder?: number | null } = {};
    if (patch.isFavorite !== undefined && patch.isFavorite !== existingWorkspace.isFavorite) {
      if (patch.isFavorite) {
        if (existingWorkspace.archived) {
          throw new FavoriteLimitError('Archived workspaces cannot be favorited');
        }
        const favoriteCount = await _prisma.workspace.count({
          where: { isFavorite: true, archived: false }
        });
        if (favoriteCount >= MAX_FAVORITE_WORKSPACES) {
          throw new FavoriteLimitError(
            `At most ${MAX_FAVORITE_WORKSPACES} favorite workspaces are allowed`
          );
        }
        const maxOrder = await _prisma.workspace.aggregate({
          where: { isFavorite: true },
          _max: { favoriteOrder: true }
        });
        favoritePatch = {
          isFavorite: true,
          favoriteOrder: (maxOrder._max.favoriteOrder ?? -1) + 1
        };
      } else {
        favoritePatch = { isFavorite: false, favoriteOrder: null };
      }
    }

    const row = await _prisma.workspace.update({
      where: { id },
      data: {
        name: patch.name ?? existingWorkspace.name,
        path: patch.path ?? existingWorkspace.path,
        group: patch.group !== undefined ? (patch.group?.trim() || null) : existingWorkspace.group,
        gitUserName: patch.gitUserName ?? existingWorkspace.gitUserName,
        gitUserEmail: patch.gitUserEmail ?? existingWorkspace.gitUserEmail,
        color: patch.color ?? existingWorkspace.color,
        defaultAgentType: patch.defaultAgentType ?? existingWorkspace.defaultAgentType,
        ...(tagsJson !== undefined && { tags: tagsJson }),
        ...favoritePatch
      }
    });
    return row;
  },

  async reorderWorkspaces(ids: string[]): Promise<void> {
    await _prisma.$transaction(
      ids.map((id, index) =>
        _prisma.workspace.update({ where: { id }, data: { sortOrder: index } })
      )
    );
  },

  async archiveWorkspace(id: string, archived: boolean): Promise<Workspace | undefined> {
    const existingWorkspace = await _prisma.workspace.findUnique({ where: { id } });
    if (!existingWorkspace) {
      return undefined;
    }
    return _prisma.workspace.update({
      where: { id },
      data: {
        archived,
        ...(archived ? { isFavorite: false, favoriteOrder: null } : {})
      }
    });
  },

  async deleteWorkspace(id: string): Promise<boolean> {
    try {
      await _prisma.workspace.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  },

  // -------------------------------------------------- Sessions --------------------------------------------------

  async listSessionsByWorkspace(
    workspaceId: string,
    opts?: { archived?: boolean }
  ): Promise<SessionWithCategory[]> {
    return _prisma.session.findMany({
      where: {
        workspaceId,
        ...(opts?.archived !== undefined ? { archived: opts.archived } : {})
      },
      orderBy: { updatedAt: 'desc' }
    }) as Promise<SessionWithCategory[]>;
  },

  async listSessions(): Promise<SessionWithCategory[]> {
    return _prisma.session.findMany({
      orderBy: { updatedAt: 'desc' }
    }) as Promise<SessionWithCategory[]>;
  },

  /**
   * List payloads do not include chat rows. If `last_preview_*` was never set
   * (older rows), derive from `session_messages` and persist so future lists are cheap.
   */
  async enrichSessionListPreviews<
    T extends { id: string; lastPreviewText?: string | null; lastPreviewRole?: string | null }
  >(sessions: T[]): Promise<void> {
    const missing = sessions.filter(
      (s) => s.lastPreviewText == null || String(s.lastPreviewText).trim() === ''
    );
    if (missing.length === 0) {
      return;
    }

    const rows = await _prisma.sessionMessage.findMany({
      where: { sessionId: { in: missing.map((m) => m.id) } },
      orderBy: [{ sessionId: 'asc' }, { position: 'asc' }]
    });
    const byId = new Map<string, ChatMessage[]>();
    for (const row of rows) {
      const list = byId.get(row.sessionId) ?? [];
      list.push(sessionMessageRowToChat(row));
      byId.set(row.sessionId, list);
    }

    for (const s of missing) {
      const messages = byId.get(s.id);
      if (!messages || messages.length === 0) {
        continue;
      }
      const p = computeLastListPreview(messages);
      if (!p) {
        continue;
      }
      s.lastPreviewText = p.lastPreviewText;
      s.lastPreviewRole = p.lastPreviewRole;
      void _prisma.session
        .update({
          where: { id: s.id },
          data: {
            lastPreviewText: p.lastPreviewText,
            lastPreviewRole: p.lastPreviewRole
          }
        })
        .catch((err) => logger.error({ err, sessionId: s.id }, 'enrichSessionListPreviews persist failed'));
    }
  },

  async getSession(id: string): Promise<SessionWithCategoryAndMessages | undefined> {
    const row = await _prisma.session.findUnique({ where: { id } });
    return (row ?? undefined) as SessionWithCategoryAndMessages | undefined;
  },

  async createSession(data: {
    name: string;
    workspaceId: string;
    tags?: string[] | null;
    agentType?: string | null;
    modelSelection?: string | null;
    sessionMode?: string | null;
    approvalPolicy?: string | null;
    sessionConfigJson?: string | null;
  }): Promise<Session> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const tagsArr =
      data.tags !== undefined && data.tags !== null && Array.isArray(data.tags)
        ? normalizeTagStringList(data.tags)
        : null;
    const tagsJson =
      tagsArr !== null && tagsArr.length > 0 ? tagsArr : Prisma.JsonNull;
    const row = await _prisma.session.create({
      data: {
        id,
        name: data.name,
        tags: tagsJson,
        sessionId: null,
        agentType: data.agentType ?? 'cursor-agent',
        modelSelection: data.modelSelection ?? 'auto',
        sessionMode: data.sessionMode ?? 'default',
        approvalPolicy: data.approvalPolicy ?? 'ask',
        sessionConfigJson: data.sessionConfigJson ?? null,
        workspaceId: data.workspaceId,
        createdAt
      }
    });
    return row;
  },

  async getLatestSessionByAgentType(agentType: string): Promise<Session | undefined> {
    const row = await _prisma.session.findFirst({
      where: { agentType },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
    });
    return row ?? undefined;
  },

  async updateSession(
    id: string,
    patch: {
      sessionId?: string | null;
      modelSelection?: string;
      sessionMode?: string;
      approvalPolicy?: string;
      sessionConfigJson?: string | null;
      lastPreviewText?: string | null;
      lastPreviewRole?: string | null;
      lastUsageJson?: string | null;
      name?: string;
      tags?: string[] | null;
      archived?: boolean;
      claudeLimitResetAt?: string | null;
    }
  ): Promise<Session | undefined> {
    const existingSession = await _prisma.session.findUnique({ where: { id } });
    if (!existingSession) {
      return undefined;
    }

    let tagsJson: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined;
    if ('tags' in patch) {
      if (patch.tags === null || patch.tags === undefined) {
        tagsJson = Prisma.JsonNull;
      } else {
        const arr = normalizeTagStringList(patch.tags);
        tagsJson = arr.length > 0 ? arr : Prisma.JsonNull;
      }
    }

    const row = await _prisma.session.update({
      where: { id },
      data: {
        sessionId: patch.sessionId ?? existingSession.sessionId,
        modelSelection: patch.modelSelection ?? existingSession.modelSelection,
        sessionMode: patch.sessionMode ?? existingSession.sessionMode,
        approvalPolicy: patch.approvalPolicy ?? existingSession.approvalPolicy,
        ...(patch.sessionConfigJson !== undefined && { sessionConfigJson: patch.sessionConfigJson }),
        ...(patch.lastPreviewText !== undefined && { lastPreviewText: patch.lastPreviewText }),
        ...(patch.lastPreviewRole !== undefined && { lastPreviewRole: patch.lastPreviewRole }),
        ...(patch.lastUsageJson !== undefined && { lastUsageJson: patch.lastUsageJson }),
        name: patch.name ?? existingSession.name,
        ...(tagsJson !== undefined && { tags: tagsJson }),
        archived: patch.archived ?? existingSession.archived,
        ...(patch.claudeLimitResetAt !== undefined && { claudeLimitResetAt: patch.claudeLimitResetAt }),
        updatedAt: new Date().toISOString()
      }
    });

    return row;
  },

  async listSessionMessages(sessionId: string): Promise<ChatMessage[]> {
    const rows = await _prisma.sessionMessage.findMany({
      where: { sessionId },
      orderBy: { position: 'asc' }
    });
    return rows.map(sessionMessageRowToChat);
  },

  async listSessionMessagesPage(
    sessionId: string,
    offset: number,
    limit: number
  ): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
    const total = await _prisma.sessionMessage.count({ where: { sessionId } });
    const endIdx = Math.max(0, total - offset);
    const startIdx = Math.max(0, endIdx - limit);
    if (endIdx <= startIdx) {
      return { messages: [], hasMore: startIdx > 0 };
    }
    const rows = await _prisma.sessionMessage.findMany({
      where: { sessionId },
      orderBy: { position: 'asc' },
      skip: startIdx,
      take: endIdx - startIdx
    });
    return {
      messages: rows.map(sessionMessageRowToChat),
      hasMore: startIdx > 0
    };
  },

  async persistSessionMessages(
    sessionId: string,
    messages: ChatMessage[],
    patch?: {
      sessionId?: string | null;
      lastPreviewText?: string | null;
      lastPreviewRole?: string | null;
      lastUsageJson?: string | null;
    }
  ): Promise<Session | undefined> {
    const existing = await _prisma.session.findUnique({ where: { id: sessionId } });
    if (!existing) {
      return undefined;
    }

    const rows = messages.map((message, position) =>
      chatMessageToRowData(sessionId, position, message, randomUUID())
    );
    const MESSAGE_INSERT_BATCH = 100;

    await _prisma.$transaction(async (tx) => {
      await tx.sessionMessage.deleteMany({ where: { sessionId } });
      for (let index = 0; index < rows.length; index += MESSAGE_INSERT_BATCH) {
        await tx.sessionMessage.createMany({
          data: rows.slice(index, index + MESSAGE_INSERT_BATCH)
        });
      }
      await tx.session.update({
        where: { id: sessionId },
        data: {
          ...(patch?.sessionId !== undefined && { sessionId: patch.sessionId }),
          ...(patch?.lastPreviewText !== undefined && { lastPreviewText: patch.lastPreviewText }),
          ...(patch?.lastPreviewRole !== undefined && { lastPreviewRole: patch.lastPreviewRole }),
          ...(patch?.lastUsageJson !== undefined && { lastUsageJson: patch.lastUsageJson }),
          updatedAt: new Date().toISOString()
        }
      });
    });

    const row = await _prisma.session.findUnique({ where: { id: sessionId } });
    return row ?? undefined;
  },

  async recordSessionUsage(
    sessionId: string,
    workspaceId: string,
    usage: SessionUsageSnapshot
  ): Promise<void> {
    const createdAt = usage.at ?? new Date().toISOString();
    await _prisma.$transaction([
      _prisma.sessionUsage.create({
        data: {
          id: randomUUID(),
          sessionId,
          workspaceId,
          used: Math.round(usage.used),
          size: Math.round(usage.size),
          costAmount: usage.cost?.amount ?? null,
          costCurrency: usage.cost?.currency ?? null,
          createdAt
        }
      }),
      _prisma.session.update({
        where: { id: sessionId },
        data: {
          lastUsageJson: serializeSessionUsage({ ...usage, at: createdAt }),
          updatedAt: new Date().toISOString()
        }
      })
    ]);
  },

  async listSessionUsage(sessionId: string, limit = 50): Promise<SessionUsageTurn[]> {
    const rows = await _prisma.sessionUsage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      used: row.used,
      size: row.size,
      ...(row.costAmount != null
        ? { cost: { amount: row.costAmount, currency: row.costCurrency ?? 'USD' } }
        : {}),
      at: row.createdAt,
      createdAt: row.createdAt
    }));
  },

  async summarizeWorkspaceUsage(workspaceId: string): Promise<WorkspaceUsageSummary> {
    return summarizeUsageWhere({ workspaceId });
  },

  async summarizeSessionUsage(sessionId: string): Promise<WorkspaceUsageSummary> {
    return summarizeUsageWhere({ sessionId });
  },

  async listSessionQueue(sessionId: string): Promise<ChatQueueItem[]> {
    const rows = await _prisma.sessionPromptQueue.findMany({
      where: { sessionId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }]
    });
    return rows.map(toChatQueueItem);
  },

  async enqueueSessionQueueItem(data: {
    sessionId: string;
    text: string;
    model: string;
    mode: string;
    imagePaths?: string[];
  }): Promise<ChatQueueItem> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const created = await _prisma.$transaction(async (tx) => {
      const max = await tx.sessionPromptQueue.aggregate({
        where: { sessionId: data.sessionId },
        _max: { position: true }
      });
      const position = (max._max.position ?? 0) + 1;
      return tx.sessionPromptQueue.create({
        data: {
          id,
          sessionId: data.sessionId,
          text: data.text,
          model: data.model,
          mode: data.mode,
          imagePaths: JSON.stringify(data.imagePaths ?? []),
          position,
          createdAt
        }
      });
    });
    return toChatQueueItem(created);
  },

  async dequeueNextSessionQueueItem(sessionId: string): Promise<ChatQueueItem | undefined> {
    const next = await _prisma.$transaction(async (tx) => {
      const row = await tx.sessionPromptQueue.findFirst({
        where: { sessionId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }]
      });
      if (!row) {
        return undefined;
      }
      await tx.sessionPromptQueue.delete({ where: { id: row.id } });
      return row;
    });
    return next ? toChatQueueItem(next) : undefined;
  },

  async deleteSessionQueueItem(sessionId: string, id: string): Promise<boolean> {
    const result = await _prisma.sessionPromptQueue.deleteMany({ where: { sessionId, id } });
    return result.count > 0;
  },

  async updateSessionQueueItemText(sessionId: string, id: string, text: string): Promise<boolean> {
    const updated = await _prisma.$transaction(async (tx) => {
      const existingQueueItem = await tx.sessionPromptQueue.findFirst({ where: { sessionId, id } });
      if (!existingQueueItem) {
        return undefined;
      }
      let imagePaths: string[] = [];
      try {
        imagePaths = JSON.parse(existingQueueItem.imagePaths ?? '[]') as string[];
      } catch {
        imagePaths = [];
      }
      if (!text && imagePaths.length === 0) {
        // A queue item needs text or at least one image.
        return undefined;
      }
      return tx.sessionPromptQueue.update({
        where: { id: existingQueueItem.id },
        data: { text }
      });
    });
    return !!updated;
  },

  async moveSessionQueueItemToFront(sessionId: string, id: string): Promise<boolean> {
    const updated = await _prisma.$transaction(async (tx) => {
      const existingQueueItem = await tx.sessionPromptQueue.findFirst({ where: { sessionId, id } });
      if (!existingQueueItem) {
        return undefined;
      }
      const min = await tx.sessionPromptQueue.aggregate({
        where: { sessionId },
        _min: { position: true }
      });
      const frontPosition = (min._min.position ?? 0) - 1;
      return tx.sessionPromptQueue.update({
        where: { id: existingQueueItem.id },
        data: { position: frontPosition }
      });
    });
    return !!updated;
  },

  // -------------------------------------------------- Orchestrators --------------------------------------------------

  async listOrchestratorsByWorkspace(workspaceId: string): Promise<OrchestratorWithCategory[]> {
    return _prisma.orchestrator.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' }
    }) as Promise<OrchestratorWithCategory[]>;
  },

  async getOrchestrator(id: string): Promise<OrchestratorWithCategory | undefined> {
    const row = await _prisma.orchestrator.findUnique({ where: { id } });
    return (row ?? undefined) as OrchestratorWithCategory | undefined;
  },

  async createOrchestrator(data: {
    name: string;
    workspaceId: string;
    tags?: string | null;
    agentType?: string;
  }): Promise<Orchestrator> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    return _prisma.orchestrator.create({
      data: {
        id,
        name: data.name,
        tags: data.tags ?? null,
        agentType: data.agentType ?? 'cursor-agent',
        messageJson: '[]',
        subtasksJson: null,
        workspaceId: data.workspaceId,
        createdAt,
        archived: false
      }
    });
  },

  async updateOrchestrator(
    id: string,
    patch: {
      name?: string;
      messageJson?: string;
      subtasksJson?: string | null;
      tags?: string | null;
      archived?: boolean;
      runStatus?: string | null;
      runCurrentStep?: number | null;
      runTotalSteps?: number | null;
      runStartedAt?: string | null;
    }
  ): Promise<Orchestrator | undefined> {
    const existing = await _prisma.orchestrator.findUnique({ where: { id } });
    if (!existing) {
      return undefined;
    }
    const data = {
      name: patch.name ?? existing.name,
      messageJson: patch.messageJson ?? existing.messageJson,
      subtasksJson: 'subtasksJson' in patch ? patch.subtasksJson : existing.subtasksJson,
      tags: 'tags' in patch ? (patch.tags ?? null) : existing.tags,
      archived: 'archived' in patch ? patch.archived! : existing.archived,
      updatedAt: new Date().toISOString(),
      ...('runStatus' in patch && { runStatus: patch.runStatus }),
      ...('runCurrentStep' in patch && { runCurrentStep: patch.runCurrentStep }),
      ...('runTotalSteps' in patch && { runTotalSteps: patch.runTotalSteps }),
      ...('runStartedAt' in patch && { runStartedAt: patch.runStartedAt })
    };
    return _prisma.orchestrator.update({
      where: { id },
      data
    });
  },

  // marks orchestrator runs that were "running" at startup as "failed" (handles container restart mid-run)
  async failStaleRunningOrchestrators(): Promise<number> {
    const now = new Date().toISOString();
    const result = await _prisma.orchestrator.updateMany({
      where: { runStatus: 'running' },
      data: {
        runStatus: 'failed',
        updatedAt: now
      }
    });
    return result.count;
  },

  async deleteOrchestrator(id: string): Promise<boolean> {
    try {
      await _prisma.orchestrator.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  },

  async deleteSession(id: string): Promise<boolean> {
    try {
      await _prisma.session.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  },

  async deleteManySessions(ids: string[], workspaceId: string): Promise<number> {
    const result = await _prisma.session.deleteMany({
      where: { id: { in: ids }, workspaceId }
    });
    return result.count;
  },

  async archiveManySessions(
    ids: string[],
    workspaceId: string,
    archived: boolean
  ): Promise<number> {
    const result = await _prisma.session.updateMany({
      where: { id: { in: ids }, workspaceId },
      data: { archived, updatedAt: new Date().toISOString() }
    });
    return result.count;
  },

  // -------------------------------------------------- Push Subscriptions --------------------------------------------------

  async upsertPushSubscription(data: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }): Promise<PushSubscription> {
    const existing = await _prisma.pushSubscription.findUnique({
      where: { endpoint: data.endpoint }
    });
    if (existing) {
      return _prisma.pushSubscription.update({
        where: { endpoint: data.endpoint },
        data: {
          userId: data.userId,
          p256dh: data.p256dh,
          auth: data.auth
        }
      });
    }
    return _prisma.pushSubscription.create({
      data: {
        id: randomUUID(),
        userId: data.userId,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        createdAt: new Date().toISOString()
      }
    });
  },

  async deletePushSubscriptionByEndpoint(endpoint: string): Promise<void> {
    await _prisma.pushSubscription.deleteMany({ where: { endpoint } });
  },

  async listPushSubscriptionsByUser(userId: string): Promise<PushSubscription[]> {
    return _prisma.pushSubscription.findMany({ where: { userId } });
  },

  async listPushSubscriptions(): Promise<PushSubscription[]> {
    return _prisma.pushSubscription.findMany();
  },

  // -------------------------------------------------- Role Templates --------------------------------------------------

  async listRoleTemplates(): Promise<RoleTemplate[]> {
    return _prisma.roleTemplate.findMany({
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }]
    });
  },

  async getRoleTemplate(id: string): Promise<RoleTemplate | undefined> {
    const row = await _prisma.roleTemplate.findUnique({ where: { id } });
    return row ?? undefined;
  },

  async findRoleTemplateByName(name: string): Promise<RoleTemplate | undefined> {
    const trimmed = name?.trim();
    if (!trimmed) {
      return undefined;
    }
    const row = await _prisma.roleTemplate.findUnique({ where: { name: trimmed } });
    return row ?? undefined;
  },

  async createRoleTemplate(data: {
    name: string;
    description?: string | null;
    content: string;
  }): Promise<RoleTemplate> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    return _prisma.roleTemplate.create({
      data: {
        id,
        name: data.name.trim(),
        description: data.description ?? null,
        content: data.content,
        createdAt
      }
    });
  },

  async updateRoleTemplate(
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      content?: string;
    }
  ): Promise<RoleTemplate | undefined> {
    const existing = await _prisma.roleTemplate.findUnique({ where: { id } });
    if (!existing) {
      return undefined;
    }
    const data: {
      name?: string;
      description?: string | null;
      content?: string;
      updatedAt: string;
    } = {
      updatedAt: new Date().toISOString()
    };
    if (patch.name !== undefined) {
      data.name = patch.name.trim();
    }
    if (patch.description !== undefined) {
      data.description = patch.description;
    }
    if (patch.content !== undefined) {
      data.content = patch.content;
    }
    return _prisma.roleTemplate.update({
      where: { id },
      data
    });
  },

  async deleteRoleTemplate(id: string): Promise<boolean> {
    try {
      await _prisma.roleTemplate.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  },

  // -------------------------------------------------- Automations --------------------------------------------------

  async listAutomations(): Promise<Automation[]> {
    return _prisma.automation.findMany({ orderBy: { createdAt: 'desc' } });
  },

  async listAutomationsByWorkspace(workspaceId: string): Promise<Automation[]> {
    return _prisma.automation.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
  },

  async getAutomation(id: string): Promise<Automation | undefined> {
    const row = await _prisma.automation.findUnique({ where: { id } });
    return row ?? undefined;
  },

  async createAutomation(data: {
    name: string;
    workspaceId: string;
    agentType?: string;
    prompt: string;
    intervalMinutes: number;
    enabled?: boolean;
  }): Promise<Automation> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const nextRunAt = new Date(Date.now() + data.intervalMinutes * 60_000).toISOString();
    return _prisma.automation.create({
      data: {
        id,
        name: data.name,
        workspaceId: data.workspaceId,
        agentType: data.agentType ?? 'cursor-agent',
        prompt: data.prompt,
        intervalMinutes: data.intervalMinutes,
        enabled: data.enabled ?? true,
        createdAt,
        nextRunAt
      }
    });
  },

  async updateAutomation(
    id: string,
    patch: {
      name?: string;
      agentType?: string;
      prompt?: string;
      intervalMinutes?: number;
      enabled?: boolean;
      nextRunAt?: string | null;
      lastRunAt?: string | null;
      lastRunStatus?: string | null;
      lastRunError?: string | null;
    }
  ): Promise<Automation | undefined> {
    const existing = await _prisma.automation.findUnique({ where: { id } });
    if (!existing) {
      return undefined;
    }
    return _prisma.automation.update({
      where: { id },
      data: {
        name: patch.name ?? existing.name,
        agentType: patch.agentType ?? existing.agentType,
        prompt: patch.prompt ?? existing.prompt,
        intervalMinutes: patch.intervalMinutes ?? existing.intervalMinutes,
        enabled: patch.enabled !== undefined ? patch.enabled : existing.enabled,
        nextRunAt: 'nextRunAt' in patch ? patch.nextRunAt : existing.nextRunAt,
        lastRunAt: 'lastRunAt' in patch ? patch.lastRunAt : existing.lastRunAt,
        lastRunStatus: 'lastRunStatus' in patch ? patch.lastRunStatus : existing.lastRunStatus,
        lastRunError: 'lastRunError' in patch ? patch.lastRunError : existing.lastRunError,
        updatedAt: new Date().toISOString()
      }
    });
  },

  async deleteAutomation(id: string): Promise<boolean> {
    try {
      await _prisma.automation.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  },

  async listEnabledAutomationsDue(): Promise<Automation[]> {
    const now = new Date().toISOString();
    return _prisma.automation.findMany({
      where: {
        enabled: true,
        nextRunAt: { lte: now },
        OR: [{ lastRunStatus: null }, { lastRunStatus: { not: 'running' } }]
      }
    });
  },

  async failStaleAutomationRuns(error = 'Interrupted by server restart'): Promise<number> {
    const finishedAt = new Date().toISOString();
    const stale = await _prisma.automationRun.updateMany({
      where: { status: 'running' },
      data: { status: 'failed', error, finishedAt }
    });
    await _prisma.automation.updateMany({
      where: { lastRunStatus: 'running' },
      data: { lastRunStatus: 'failed', lastRunError: error }
    });
    return stale.count;
  },

  // -------------------------------------------------- Automation Runs --------------------------------------------------

  async listRunsByAutomation(automationId: string, limit = 20): Promise<AutomationRun[]> {
    return _prisma.automationRun.findMany({
      where: { automationId },
      orderBy: { startedAt: 'desc' },
      take: limit
    });
  },

  async getAutomationRun(id: string): Promise<AutomationRun | undefined> {
    const row = await _prisma.automationRun.findUnique({ where: { id } });
    return row ?? undefined;
  },

  async createAutomationRun(automationId: string): Promise<AutomationRun> {
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    return _prisma.automationRun.create({
      data: { id, automationId, startedAt, status: 'running' }
    });
  },

  async updateAutomationRun(
    id: string,
    patch: {
      status?: string;
      finishedAt?: string;
      agentResponse?: string | null;
      changedFiles?: string | null;
      error?: string | null;
      sessionId?: string | null;
    }
  ): Promise<AutomationRun | undefined> {
    const existing = await _prisma.automationRun.findUnique({ where: { id } });
    if (!existing) {
      return undefined;
    }
    return _prisma.automationRun.update({
      where: { id },
      data: {
        status: patch.status ?? existing.status,
        finishedAt: patch.finishedAt ?? existing.finishedAt,
        agentResponse:
          'agentResponse' in patch ? patch.agentResponse : existing.agentResponse,
        changedFiles:
          'changedFiles' in patch ? patch.changedFiles : existing.changedFiles,
        error: 'error' in patch ? patch.error : existing.error,
        sessionId: 'sessionId' in patch ? patch.sessionId : existing.sessionId
      }
    });
  },

  async pruneAutomationRuns(automationId: string, keep = 50): Promise<void> {
    const extra = await _prisma.automationRun.findMany({
      where: { automationId },
      orderBy: { startedAt: 'desc' },
      skip: keep,
      select: { id: true }
    });
    if (extra.length === 0) {
      return;
    }
    await _prisma.automationRun.deleteMany({
      where: { id: { in: extra.map((row) => row.id) } }
    });
  },

  // -------------------------------------------------- Search --------------------------------------------------

  async searchCatalog(query: string): Promise<{
    workspaces: SearchHit[];
    sessions: SearchHit[];
    orchestrators: SearchHit[];
    roleTemplates: SearchHit[];
    automations: SearchHit[];
  }> {
    const contains = ilikeContains(query.trim());

    const [workspaces, sessions, orchestrators, roleTemplates, automations] = await Promise.all([
      _prisma.workspace.findMany({
        where: { archived: false, name: contains },
        select: { id: true, name: true },
        take: SEARCH_LIMIT,
        orderBy: { name: 'asc' }
      }),
      _prisma.session.findMany({
        where: {
          archived: false,
          OR: [
            { name: contains },
            { lastPreviewText: contains },
            { messages: { some: { content: contains } } }
          ]
        },
        select: {
          id: true,
          name: true,
          lastPreviewText: true,
          workspaceId: true,
          workspace: { select: { name: true } }
        },
        take: SEARCH_LIMIT,
        orderBy: { updatedAt: 'desc' }
      }),
      _prisma.orchestrator.findMany({
        where: {
          archived: false,
          OR: [{ name: contains }, { messageJson: contains }, { tags: contains }]
        },
        select: {
          id: true,
          name: true,
          workspaceId: true,
          workspace: { select: { name: true } }
        },
        take: SEARCH_LIMIT,
        orderBy: { updatedAt: 'desc' }
      }),
      _prisma.roleTemplate.findMany({
        where: { OR: [{ name: contains }, { content: contains }] },
        select: { id: true, name: true },
        take: SEARCH_LIMIT,
        orderBy: { name: 'asc' }
      }),
      _prisma.automation.findMany({
        where: { OR: [{ name: contains }, { prompt: contains }] },
        select: {
          id: true,
          name: true,
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
          workspaceName: session.workspace.name
        };
      }),
      orchestrators: orchestrators.map((orchestrator) => ({
        id: orchestrator.id,
        name: orchestrator.name?.trim() || 'Untitled orchestrator',
        type: 'orchestrator' as const,
        workspaceId: orchestrator.workspaceId,
        workspaceName: orchestrator.workspace.name
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
        workspaceName: automation.workspace.name
      }))
    };
  }
};
