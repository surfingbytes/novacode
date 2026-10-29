// node_modules
import { randomUUID } from 'node:crypto';

// classes
import { prisma } from './client';

// types
import type { OrchestratorModel as Orchestrator } from '../../generated/client/models/Orchestrator';
import type { OrchestratorWithCategory } from './shared';

// --------------------------------------------- Orchestrators ---------------------------------------------

async function listOrchestratorsByWorkspace(workspaceId: string): Promise<OrchestratorWithCategory[]> {
  return prisma.orchestrator.findMany({
    where: { workspaceId },
    orderBy: { updatedAt: 'desc' }
  }) as Promise<OrchestratorWithCategory[]>;
}

/**
 * Non-archived orchestrators of every workspace for the nav sidebar, without
 * the planning chat (`messageJson`), which can be large and isn't needed there.
 */
async function listOrchestratorSummaries(): Promise<Omit<OrchestratorWithCategory, 'messageJson'>[]> {
  return prisma.orchestrator.findMany({
    where: { archived: false },
    omit: { messageJson: true },
    orderBy: { updatedAt: 'desc' }
  });
}

async function getOrchestrator(id: string): Promise<OrchestratorWithCategory | undefined> {
  const row = await prisma.orchestrator.findUnique({ where: { id } });
  return (row ?? undefined) as OrchestratorWithCategory | undefined;
}

async function createOrchestrator(data: {
  name: string;
  workspaceId: string;
  tags?: string | null;
  agentType?: string;
  sourceSessionId?: string | null;
  workerModel?: string | null;
  maxParallel?: number;
  verifyAgentType?: string | null;
  verifyModel?: string | null;
}): Promise<Orchestrator> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  return prisma.orchestrator.create({
    data: {
      id,
      name: data.name,
      tags: data.tags ?? null,
      agentType: data.agentType ?? 'cursor-agent',
      messageJson: '[]',
      subtasksJson: null,
      workspaceId: data.workspaceId,
      createdAt,
      archived: false,
      sourceSessionId: data.sourceSessionId ?? null,
      workerModel: data.workerModel ?? null,
      verifyAgentType: data.verifyAgentType ?? null,
      verifyModel: data.verifyModel ?? null,
      ...(data.maxParallel !== undefined && { maxParallel: data.maxParallel })
    }
  });
}

/** Newest non-archived plan generated from a chat session (spec → orchestrator). */
async function getLatestOrchestratorBySourceSession(
  sourceSessionId: string
): Promise<OrchestratorWithCategory | undefined> {
  const row = await prisma.orchestrator.findFirst({
    where: { sourceSessionId, archived: false },
    orderBy: { createdAt: 'desc' }
  });
  return (row ?? undefined) as OrchestratorWithCategory | undefined;
}

async function updateOrchestrator(
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
    /** Server-set only (never accepted from the PATCH route). */
    runChangedFiles?: number | null;
    runMode?: string | null;
    agentType?: string;
    workerModel?: string | null;
    maxParallel?: number;
    verifyAgentType?: string | null;
    verifyModel?: string | null;
    sourceSessionId?: string | null;
    isFavorite?: boolean;
    unread?: boolean;
  }
): Promise<Orchestrator | undefined> {
  const existing = await prisma.orchestrator.findUnique({ where: { id } });
  if (!existing) {
    return undefined;
  }
  const archived = 'archived' in patch ? patch.archived! : existing.archived;
  // Starring / reading should not reshuffle lists by last-interaction date.
  const bFlagOnly = Object.keys(patch).every((key) => key === 'isFavorite' || key === 'unread');
  const data = {
    name: patch.name ?? existing.name,
    messageJson: patch.messageJson ?? existing.messageJson,
    subtasksJson: 'subtasksJson' in patch ? patch.subtasksJson : existing.subtasksJson,
    tags: 'tags' in patch ? (patch.tags ?? null) : existing.tags,
    archived,
    isFavorite: archived ? false : (patch.isFavorite ?? existing.isFavorite),
    ...(patch.unread !== undefined && { unread: patch.unread }),
    updatedAt: bFlagOnly ? existing.updatedAt : new Date().toISOString(),
    ...('runStatus' in patch && { runStatus: patch.runStatus }),
    ...('runCurrentStep' in patch && { runCurrentStep: patch.runCurrentStep }),
    ...('runTotalSteps' in patch && { runTotalSteps: patch.runTotalSteps }),
    ...('runStartedAt' in patch && { runStartedAt: patch.runStartedAt }),
    ...('runChangedFiles' in patch && { runChangedFiles: patch.runChangedFiles }),
    ...('runMode' in patch && { runMode: patch.runMode }),
    ...(patch.agentType !== undefined && { agentType: patch.agentType }),
    ...('workerModel' in patch && { workerModel: patch.workerModel }),
    ...(patch.maxParallel !== undefined && { maxParallel: patch.maxParallel }),
    ...('verifyAgentType' in patch && { verifyAgentType: patch.verifyAgentType }),
    ...('verifyModel' in patch && { verifyModel: patch.verifyModel }),
    ...('sourceSessionId' in patch && { sourceSessionId: patch.sourceSessionId })
  };
  return prisma.orchestrator.update({
    where: { id },
    data
  });
}

// marks orchestrator runs that were "running" at startup as "failed" (handles container restart mid-run)
async function failStaleRunningOrchestrators(): Promise<number> {
  const now = new Date().toISOString();
  const result = await prisma.orchestrator.updateMany({
    where: { runStatus: 'running' },
    data: {
      runStatus: 'failed',
      updatedAt: now
    }
  });
  return result.count;
}

async function deleteOrchestrator(id: string): Promise<boolean> {
  try {
    await prisma.orchestrator.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

async function deleteSession(id: string): Promise<boolean> {
  try {
    await prisma.session.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

async function listOrchestratorSessionIds(orchestratorId: string): Promise<string[]> {
  const rows = await prisma.session.findMany({ where: { orchestratorId }, select: { id: true } });
  return rows.map((row) => row.id);
}

async function deleteManySessions(ids: string[], workspaceId: string): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { id: { in: ids }, workspaceId }
  });
  return result.count;
}

async function archiveManySessions(
  ids: string[],
  workspaceId: string,
  archived: boolean
): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { id: { in: ids }, workspaceId },
    data: { archived, updatedAt: new Date().toISOString() }
  });
  return result.count;
}

export const orchestratorDb = {
  listOrchestratorsByWorkspace,
  listOrchestratorSummaries,
  getOrchestrator,
  createOrchestrator,
  getLatestOrchestratorBySourceSession,
  updateOrchestrator,
  failStaleRunningOrchestrators,
  deleteOrchestrator,
  deleteSession,
  listOrchestratorSessionIds,
  deleteManySessions,
  archiveManySessions
};
