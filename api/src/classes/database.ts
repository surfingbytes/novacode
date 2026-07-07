// node_modules
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// classes/api
import { ensureDatabaseUrl } from '../env';
import { PrismaClient, Prisma } from '../generated/client/client';
import { config } from './config';
import { computeLastListPreview } from './chatPreview';

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
import type { ChatMessage, ChatQueueItem } from '../@types/index';

/** Session without messageJson */
export type SessionWithCategory = Omit<Session, 'messageJson'>;
/** Session with all fields */
export type SessionWithCategoryAndMessages = Session;
/** Orchestrator (alias for backward compat) */
export type OrchestratorWithCategory = Orchestrator;

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

export const db = {
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
        ...(tagsJson !== undefined && { tags: tagsJson })
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
    return _prisma.workspace.update({ where: { id }, data: { archived } });
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
      omit: { messageJson: true },
      orderBy: { updatedAt: 'desc' }
    }) as Promise<SessionWithCategory[]>;
  },

  async listSessions(): Promise<SessionWithCategory[]> {
    return _prisma.session.findMany({
      omit: { messageJson: true },
      orderBy: { updatedAt: 'desc' }
    }) as Promise<SessionWithCategory[]>;
  },

  /**
   * List payloads omit `messageJson`. If `last_preview_*` was never set (older rows),
   * derive from `message_json` and persist so future lists are cheap.
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

    const rows = await _prisma.session.findMany({
      where: { id: { in: missing.map((m) => m.id) } },
      select: { id: true, messageJson: true }
    });
    const byId = new Map(rows.map((r) => [r.id, r.messageJson]));

    for (const s of missing) {
      const mj = byId.get(s.id);
      if (!mj || mj === '[]') {
        continue;
      }
      let messages: ChatMessage[];
      try {
        messages = JSON.parse(mj) as ChatMessage[];
      } catch {
        continue;
      }
      if (!Array.isArray(messages) || messages.length === 0) {
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
        .catch((err) => console.error('[db] enrichSessionListPreviews persist failed', s.id, err));
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
        sessionConfigJson: data.sessionConfigJson ?? null,
        messageJson: '[]',
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
      sessionConfigJson?: string | null;
      messageJson?: string;
      lastPreviewText?: string | null;
      lastPreviewRole?: string | null;
      name?: string;
      tags?: string[] | null;
      archived?: boolean;
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
        ...(patch.sessionConfigJson !== undefined && { sessionConfigJson: patch.sessionConfigJson }),
        messageJson: patch.messageJson ?? existingSession.messageJson,
        ...(patch.lastPreviewText !== undefined && { lastPreviewText: patch.lastPreviewText }),
        ...(patch.lastPreviewRole !== undefined && { lastPreviewRole: patch.lastPreviewRole }),
        name: patch.name ?? existingSession.name,
        ...(tagsJson !== undefined && { tags: tagsJson }),
        archived: patch.archived ?? existingSession.archived,
        updatedAt: new Date().toISOString()
      }
    });

    return row;
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
      where: { enabled: true, nextRunAt: { lte: now } }
    });
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
        error: 'error' in patch ? patch.error : existing.error
      }
    });
  }
};
