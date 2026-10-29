// node_modules
import { randomUUID } from 'node:crypto';

// classes
import { prisma } from './client';

// types
import type { AutomationModel as Automation } from '../../generated/client/models/Automation';
import type { AutomationRunModel as AutomationRun } from '../../generated/client/models/AutomationRun';

// --------------------------------------------- Automations ---------------------------------------------

async function listAutomations(): Promise<Automation[]> {
  return prisma.automation.findMany({ orderBy: { createdAt: 'desc' } });
}

async function listAutomationsByWorkspace(workspaceId: string): Promise<Automation[]> {
  return prisma.automation.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
}

async function getAutomation(id: string): Promise<Automation | undefined> {
  const row = await prisma.automation.findUnique({ where: { id } });
  return row ?? undefined;
}

async function createAutomation(data: {
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
  return prisma.automation.create({
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
}

async function updateAutomation(
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
  const existing = await prisma.automation.findUnique({ where: { id } });
  if (!existing) {
    return undefined;
  }
  return prisma.automation.update({
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
}

async function deleteAutomation(id: string): Promise<boolean> {
  try {
    await prisma.automation.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

async function listEnabledAutomationsDue(): Promise<Automation[]> {
  const now = new Date().toISOString();
  return prisma.automation.findMany({
    where: {
      enabled: true,
      nextRunAt: { lte: now },
      OR: [{ lastRunStatus: null }, { lastRunStatus: { not: 'running' } }]
    }
  });
}

async function failStaleAutomationRuns(error = 'Interrupted by server restart'): Promise<number> {
  const finishedAt = new Date().toISOString();
  const stale = await prisma.automationRun.updateMany({
    where: { status: 'running' },
    data: { status: 'failed', error, finishedAt }
  });
  await prisma.automation.updateMany({
    where: { lastRunStatus: 'running' },
    data: { lastRunStatus: 'failed', lastRunError: error }
  });
  return stale.count;
}

async function listRunsByAutomation(automationId: string, limit = 20): Promise<AutomationRun[]> {
  return prisma.automationRun.findMany({
    where: { automationId },
    orderBy: { startedAt: 'desc' },
    take: limit
  });
}

async function getAutomationRun(id: string): Promise<AutomationRun | undefined> {
  const row = await prisma.automationRun.findUnique({ where: { id } });
  return row ?? undefined;
}

async function createAutomationRun(automationId: string): Promise<AutomationRun> {
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  return prisma.automationRun.create({
    data: { id, automationId, startedAt, status: 'running' }
  });
}

async function updateAutomationRun(
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
  const existing = await prisma.automationRun.findUnique({ where: { id } });
  if (!existing) {
    return undefined;
  }
  return prisma.automationRun.update({
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
}

async function pruneAutomationRuns(automationId: string, keep = 50): Promise<void> {
  const extra = await prisma.automationRun.findMany({
    where: { automationId },
    orderBy: { startedAt: 'desc' },
    skip: keep,
    select: { id: true }
  });
  if (extra.length === 0) {
    return;
  }
  await prisma.automationRun.deleteMany({
    where: { id: { in: extra.map((row) => row.id) } }
  });
}

export const automationDb = {
  listAutomations,
  listAutomationsByWorkspace,
  getAutomation,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  listEnabledAutomationsDue,
  failStaleAutomationRuns,
  listRunsByAutomation,
  getAutomationRun,
  createAutomationRun,
  updateAutomationRun,
  pruneAutomationRuns
};
