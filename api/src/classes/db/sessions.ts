// node_modules
import { randomUUID } from 'node:crypto';

// classes
import { Prisma } from '../../generated/client/client';
import { computeLastListPreview } from '../chatPreview';
import { chatMessageToRowData, planUpdateTargetIndex, sessionMessageRowToChat } from '../sessionMessages';
import { serializeSessionUsage } from '../sessionUsage';
import { logger } from '../logger';
import { prisma } from './client';
import { FavoriteLimitError, normalizeTagStringList, QUEUE_RETURNING, toChatQueueItem } from './shared';

// types
import type { QueueRow } from './shared';
import type { SessionModel as Session } from '../../generated/client/models/Session';
import type { ChatMessage, ChatQueueItem, SessionUsageSnapshot, SessionUsageTurn, WorkspaceUsageSummary } from '../../@types/index';
import type { SessionWithCategory, SessionWithCategoryAndMessages } from './shared';

// --------------------------------------------- Sessions ---------------------------------------------

async function summarizeUsageWhere(
  where: { workspaceId: string } | { sessionId: string }
): Promise<WorkspaceUsageSummary> {
  const aggregate = await prisma.sessionUsage.aggregate({
    where,
    _count: { id: true },
    _sum: { used: true, size: true, costAmount: true }
  });
  const withCurrency = await prisma.sessionUsage.findFirst({
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

async function listSessionsByWorkspace(
  workspaceId: string,
  opts?: { archived?: boolean }
): Promise<SessionWithCategory[]> {
  return prisma.session.findMany({
    where: {
      workspaceId,
      ...(opts?.archived !== undefined ? { archived: opts.archived } : {})
    },
    orderBy: { updatedAt: 'desc' }
  }) as Promise<SessionWithCategory[]>;
}

async function listSessions(): Promise<SessionWithCategory[]> {
  return prisma.session.findMany({
    orderBy: { updatedAt: 'desc' }
  }) as Promise<SessionWithCategory[]>;
}

/**
 * List payloads do not include chat rows. If `last_preview_*` was never set
 * (older rows), derive from `session_messages` and persist so future lists are cheap.
 */
async function enrichSessionListPreviews<
  T extends { id: string; lastPreviewText?: string | null; lastPreviewRole?: string | null }
>(sessions: T[]): Promise<void> {
  const missing = sessions.filter(
    (s) => s.lastPreviewText == null || String(s.lastPreviewText).trim() === ''
  );
  if (missing.length === 0) {
    return;
  }

  const rows = await prisma.sessionMessage.findMany({
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
    void prisma.session
      .update({
        where: { id: s.id },
        data: {
          lastPreviewText: p.lastPreviewText,
          lastPreviewRole: p.lastPreviewRole
        }
      })
      .catch((err) => logger.error({ err, sessionId: s.id }, 'enrichSessionListPreviews persist failed'));
  }
}

async function getSession(id: string): Promise<SessionWithCategoryAndMessages | undefined> {
  const row = await prisma.session.findUnique({ where: { id } });
  return (row ?? undefined) as SessionWithCategoryAndMessages | undefined;
}

async function createSession(data: {
  name: string;
  workspaceId: string;
  tags?: string[] | null;
  agentType?: string | null;
  modelSelection?: string | null;
  sessionMode?: string | null;
  approvalPolicy?: string | null;
  sessionConfigJson?: string | null;
  orchestratorId?: string | null;
}): Promise<Session> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const tagsArr =
    data.tags !== undefined && data.tags !== null && Array.isArray(data.tags)
      ? normalizeTagStringList(data.tags)
      : null;
  const tagsJson =
    tagsArr !== null && tagsArr.length > 0 ? tagsArr : Prisma.JsonNull;
  const row = await prisma.session.create({
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
      orchestratorId: data.orchestratorId ?? null,
      workspaceId: data.workspaceId,
      createdAt
    }
  });
  return row;
}

async function getLatestSessionByAgentType(agentType: string): Promise<Session | undefined> {
  const row = await prisma.session.findFirst({
    where: { agentType },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
  });
  return row ?? undefined;
}

async function updateSession(
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
    isFavorite?: boolean;
    claudeLimitResetAt?: string | null;
  }
): Promise<Session | undefined> {
  const existingSession = await prisma.session.findUnique({ where: { id } });
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

  const archived = patch.archived ?? existingSession.archived;
  let isFavorite = existingSession.isFavorite;
  if (patch.isFavorite !== undefined) {
    if (patch.isFavorite && archived) {
      throw new FavoriteLimitError('Archived sessions cannot be favorited');
    }
    isFavorite = patch.isFavorite;
  }
  if (archived) {
    isFavorite = false;
  }

  // Starring should not reshuffle lists by last-interaction date.
  const favoriteOnly =
    patch.isFavorite !== undefined &&
    patch.sessionId === undefined &&
    patch.modelSelection === undefined &&
    patch.sessionMode === undefined &&
    patch.approvalPolicy === undefined &&
    patch.sessionConfigJson === undefined &&
    patch.lastPreviewText === undefined &&
    patch.lastPreviewRole === undefined &&
    patch.lastUsageJson === undefined &&
    patch.name === undefined &&
    !('tags' in patch) &&
    patch.archived === undefined &&
    patch.claudeLimitResetAt === undefined;

  const row = await prisma.session.update({
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
      archived,
      isFavorite,
      ...(patch.claudeLimitResetAt !== undefined && { claudeLimitResetAt: patch.claudeLimitResetAt }),
      ...(!favoriteOnly && { updatedAt: new Date().toISOString() })
    }
  });

  return row;
}

/** Point a session at a git worktree (orchestrator parallel step) or back at the workspace (null). */
async function setSessionWorktreePath(id: string, worktreePath: string | null): Promise<void> {
  await prisma.session.updateMany({ where: { id }, data: { worktreePath } });
}

/**
 * Toggle the unread flag without bumping updatedAt (read/unread should not
 * reshuffle session lists). Returns undefined when the row is missing or
 * already has the requested value.
 */
async function setSessionUnread(id: string, unread: boolean): Promise<Session | undefined> {
  const existingSession = await prisma.session.findUnique({
    where: { id },
    select: { unread: true }
  });
  if (!existingSession || existingSession.unread === unread) {
    return undefined;
  }
  return prisma.session.update({
    where: { id },
    data: { unread }
  });
}

async function listSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const rows = await prisma.sessionMessage.findMany({
    where: { sessionId },
    orderBy: { position: 'asc' }
  });
  return rows.map(sessionMessageRowToChat);
}

async function listSessionMessagesPage(
  sessionId: string,
  offset: number,
  limit: number
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  const total = await prisma.sessionMessage.count({ where: { sessionId } });
  const endIdx = Math.max(0, total - offset);
  const startIdx = Math.max(0, endIdx - limit);
  if (endIdx <= startIdx) {
    return { messages: [], hasMore: startIdx > 0 };
  }
  const rows = await prisma.sessionMessage.findMany({
    where: { sessionId },
    orderBy: { position: 'asc' },
    skip: startIdx,
    take: endIdx - startIdx
  });
  return {
    messages: rows.map(sessionMessageRowToChat),
    hasMore: startIdx > 0
  };
}

/**
 * Append an ACP-style `sessionUpdate: "plan"` event into chat history so the
 * Plan tab survives reload (same persistence path Claude ACP plan updates use).
 */
async function appendSessionPlanUpdate(sessionId: string, line: string): Promise<boolean> {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return false;

  const rows = await prisma.sessionMessage.findMany({
    where: { sessionId },
    orderBy: { position: 'asc' },
  });
  const messages = rows.map(sessionMessageRowToChat);
  const targetIndex = planUpdateTargetIndex(messages);

  if (targetIndex >= 0) {
    const events = [...(messages[targetIndex].events ?? []), line];
    await prisma.sessionMessage.update({
      where: { id: rows[targetIndex].id },
      data: { eventsJson: JSON.stringify(events) },
    });
    await prisma.session.update({
      where: { id: sessionId },
      data: { updatedAt: new Date().toISOString() },
    });
    return true;
  }

  const max = await prisma.sessionMessage.aggregate({
    where: { sessionId },
    _max: { position: true },
  });
  const position = (max._max.position ?? -1) + 1;
  const createdAt = new Date().toISOString();
  await prisma.$transaction([
    prisma.sessionMessage.create({
      data: {
        id: randomUUID(),
        sessionId,
        position,
        role: 'assistant',
        content: '',
        eventsJson: JSON.stringify([line]),
        imagePathsJson: null,
        searchText: '',
        createdAt,
      },
    }),
    prisma.session.update({
      where: { id: sessionId },
      data: { updatedAt: createdAt },
    }),
  ]);
  return true;
}

async function persistSessionMessages(
  sessionId: string,
  messages: ChatMessage[],
  patch?: {
    sessionId?: string | null;
    lastPreviewText?: string | null;
    lastPreviewRole?: string | null;
    lastUsageJson?: string | null;
  },
  opts?: {
    /**
     * Rows before this position are already persisted and left untouched;
     * rows from it on are replaced. Rewriting a whole long history every turn
     * made the save outlast the transaction timeout and drop the turn.
     */
    fromPosition?: number;
  }
): Promise<Session | undefined> {
  const existing = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!existing) {
    return undefined;
  }

  const fromPosition = Math.max(0, Math.min(opts?.fromPosition ?? 0, messages.length));
  const rows = messages
    .slice(fromPosition)
    .map((message, index) =>
      chatMessageToRowData(sessionId, fromPosition + index, message, randomUUID())
    );
  const MESSAGE_INSERT_BATCH = 100;

  await prisma.$transaction(async (tx) => {
    await tx.sessionMessage.deleteMany({
      where: { sessionId, ...(fromPosition > 0 && { position: { gte: fromPosition } }) }
    });
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
  }, { timeout: 60_000 });

  const row = await prisma.session.findUnique({ where: { id: sessionId } });
  return row ?? undefined;
}

async function recordSessionUsage(
  sessionId: string,
  workspaceId: string,
  usage: SessionUsageSnapshot
): Promise<void> {
  const createdAt = usage.at ?? new Date().toISOString();
  await prisma.$transaction([
    prisma.sessionUsage.create({
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
    prisma.session.update({
      where: { id: sessionId },
      data: {
        lastUsageJson: serializeSessionUsage({ ...usage, at: createdAt }),
        updatedAt: new Date().toISOString()
      }
    })
  ]);
}

async function listSessionUsage(sessionId: string, limit = 50): Promise<SessionUsageTurn[]> {
  const rows = await prisma.sessionUsage.findMany({
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
}

async function summarizeWorkspaceUsage(workspaceId: string): Promise<WorkspaceUsageSummary> {
  return summarizeUsageWhere({ workspaceId });
}

async function summarizeSessionUsage(sessionId: string): Promise<WorkspaceUsageSummary> {
  return summarizeUsageWhere({ sessionId });
}

async function listSessionQueue(sessionId: string): Promise<ChatQueueItem[]> {
  const rows = await prisma.sessionPromptQueue.findMany({
    where: { sessionId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }]
  });
  return rows.map(toChatQueueItem);
}

async function enqueueSessionQueueItem(data: {
  sessionId: string;
  text: string;
  model: string;
  mode: string;
  imagePaths?: string[];
}): Promise<ChatQueueItem> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  // Single statement, not an interactive transaction: under load the 5s
  // interactive-transaction timeout expired on commit and the prompt was lost.
  const rows = await prisma.$queryRaw<QueueRow[]>`
    INSERT INTO session_prompt_queue
      (id, session_id, text, model, session_mode, image_paths_json, position, created_at)
    SELECT ${id}, ${data.sessionId}, ${data.text}, ${data.model}, ${data.mode},
      ${JSON.stringify(data.imagePaths ?? [])}, COALESCE(MAX(position), 0) + 1, ${createdAt}
    FROM session_prompt_queue
    WHERE session_id = ${data.sessionId}
    RETURNING ${QUEUE_RETURNING}`;
  return toChatQueueItem(rows[0]!);
}

async function dequeueNextSessionQueueItem(sessionId: string): Promise<ChatQueueItem | undefined> {
  const rows = await prisma.$queryRaw<QueueRow[]>`
    DELETE FROM session_prompt_queue
    WHERE id = (
      SELECT id FROM session_prompt_queue
      WHERE session_id = ${sessionId}
      ORDER BY position ASC, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING ${QUEUE_RETURNING}`;
  return rows[0] ? toChatQueueItem(rows[0]) : undefined;
}

async function deleteSessionQueueItem(sessionId: string, id: string): Promise<boolean> {
  const result = await prisma.sessionPromptQueue.deleteMany({ where: { sessionId, id } });
  return result.count > 0;
}

async function updateSessionQueueItemText(sessionId: string, id: string, text: string): Promise<boolean> {
  const updated = await prisma.$transaction(async (tx) => {
    const existingQueueItem = await tx.sessionPromptQueue.findFirst({ where: { sessionId, id } });
    if (!existingQueueItem) {
      return undefined;
    }
    let imagePaths: string[];
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
}

async function moveSessionQueueItemToFront(sessionId: string, id: string): Promise<boolean> {
  const updated = await prisma.$transaction(async (tx) => {
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
}

export const sessionDb = {
  listSessionsByWorkspace,
  listSessions,
  enrichSessionListPreviews,
  getSession,
  createSession,
  getLatestSessionByAgentType,
  updateSession,
  setSessionWorktreePath,
  setSessionUnread,
  listSessionMessages,
  listSessionMessagesPage,
  appendSessionPlanUpdate,
  persistSessionMessages,
  recordSessionUsage,
  listSessionUsage,
  summarizeWorkspaceUsage,
  summarizeSessionUsage,
  listSessionQueue,
  enqueueSessionQueueItem,
  dequeueNextSessionQueueItem,
  deleteSessionQueueItem,
  updateSessionQueueItemText,
  moveSessionQueueItemToFront
};
