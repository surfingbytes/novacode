// classes
import { db } from './database';
import { subscribeBusy } from './chatEngine';
import { classifyAgentError } from './agentError';
import { isOrchestratorRunActive } from './orchestratorRunner';
import { appendHandoff, parseSubtasksPayloadString, serializeSubtasksPayload, summarizeStepHandoff } from './orchestratorPayload';
import { updateOrchestratorAndBroadcast } from './orchestratorEvents';
import { logger } from './logger';

// types
import type { ChatMessage, OrchestratorSubtasksPayload, SubTask } from '../@types/index';

/**
 * Follow-up turns: a prompt sent in a finished step's session while no run is in
 * flight works on that step again, so the step shows `running` and gets the
 * turn's result (and the plan's status is worked out again) when the turn ends.
 */

/** Step sessions with a follow-up turn in progress, by session id. */
const followUps = new Map<string, { orchestratorId: string; previous: 'done' | 'failed' }>();
/** Follow-up starts still being saved, by session id. */
const startingFollowUps = new Map<string, Promise<void>>();
/** Serializes the read-modify-write of each plan's steps, by orchestrator id. */
const updateChains = new Map<string, Promise<void>>();

function updateSteps(
  orchestratorId: string,
  update: (payload: OrchestratorSubtasksPayload, runStatus: string | null) => { runStatus?: string | null } | null
): Promise<void> {
  const next = (updateChains.get(orchestratorId) ?? Promise.resolve())
    .then(async () => {
      // A run in flight owns the plan's state (it saves its whole payload).
      if (isOrchestratorRunActive(orchestratorId)) return;
      const orchestrator = await db.getOrchestrator(orchestratorId);
      const payload = orchestrator && parseSubtasksPayloadString(orchestrator.subtasksJson);
      if (!orchestrator || !payload) return;
      const patch = update(payload, orchestrator.runStatus ?? null);
      if (!patch) return;
      await updateOrchestratorAndBroadcast(orchestrator.workspaceId, orchestratorId, {
        ...patch,
        runCurrentStep: payload.subtasks.filter((task) => task.runResult && task.runResult !== 'running').length,
        runTotalSteps: payload.subtasks.length,
        subtasksJson: serializeSubtasksPayload(payload)
      });
    })
    .catch((err) => logger.warn({ err, orchestratorId }, 'Could not save a follow-up turn of an orchestrator step'));
  updateChains.set(orchestratorId, next);
  void next.then(() => {
    if (updateChains.get(orchestratorId) === next) updateChains.delete(orchestratorId);
  });
  return next;
}

/** Steps a follow-up turn can work on: they ran in their session and their work is where that session works. */
function canFollowUp(task: SubTask): boolean {
  return (task.runResult === 'done' || task.runResult === 'failed') && task.kind !== 'merge' && !task.keptBranch;
}

/** The error the turn's assistant message ended with, or null when the turn went well. */
export function followUpTurnError(messages: ChatMessage[]): string | null {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return null;
  for (const line of [...(last.events ?? [])].reverse()) {
    try {
      const event = JSON.parse(line) as { type?: unknown; text?: unknown };
      if (event.type === 'stderr') {
        return classifyAgentError(typeof event.text === 'string' ? event.text : '', { agentLabel: 'Agent' }).message;
      }
    } catch {
      // non-JSON stream lines
    }
  }
  return null;
}

/** The plan's status once a follow-up turn ended; null keeps the current one. */
function followUpRunStatus(subtasks: SubTask[], current: string | null): string | null {
  if (subtasks.some((task) => task.runResult === 'failed')) return 'failed';
  // Skipped steps never ran, so the plan isn't completed while any are left.
  if (subtasks.every((task) => task.runResult === 'done')) return 'completed';
  return current;
}

async function startFollowUp(sessionId: string): Promise<void> {
  const session = await db.getSession(sessionId);
  const orchestratorId = session?.orchestratorId;
  if (!orchestratorId || isOrchestratorRunActive(orchestratorId)) return;
  await updateSteps(orchestratorId, (payload) => {
    const task = payload.subtasks.find((candidate) => candidate.sessionId === sessionId);
    if (!task || !canFollowUp(task) || followUps.has(sessionId)) return null;
    followUps.set(sessionId, { orchestratorId, previous: task.runResult === 'failed' ? 'failed' : 'done' });
    task.runResult = 'running';
    task.waitingQuestion = null;
    task.finishedAt = null;
    return {};
  });
}

async function finishFollowUp(sessionId: string): Promise<void> {
  // A short turn can end before its start was saved.
  await startingFollowUps.get(sessionId);
  const followUp = followUps.get(sessionId);
  if (!followUp) return;
  followUps.delete(sessionId);
  const messages = await db.listSessionMessages(sessionId).catch(() => []);
  const error = followUpTurnError(messages);
  await updateSteps(followUp.orchestratorId, (payload, runStatus) => {
    const index = payload.subtasks.findIndex((task) => task.sessionId === sessionId);
    const task = payload.subtasks[index];
    if (!task || task.runResult !== 'running') return null;
    task.runResult = error ? 'failed' : 'done';
    task.runNote = error;
    task.finishedAt = new Date().toISOString();
    // The handoff of a step that failed before is still missing.
    if (!error && followUp.previous === 'failed') {
      payload.handoffLog = appendHandoff(payload.handoffLog, index + 1, task.name, summarizeStepHandoff(messages));
    }
    return { runStatus: followUpRunStatus(payload.subtasks, runStatus) };
  });
}

/** Pending follow-up saves, awaited on shutdown after the chat runs were cancelled. */
const pendingSaves = new Set<Promise<void>>();

function track(promise: Promise<void>): void {
  pendingSaves.add(promise);
  void promise.finally(() => pendingSaves.delete(promise));
}

export async function waitForStepFollowUps(): Promise<void> {
  await Promise.allSettled([...pendingSaves]);
}

export function installStepFollowUpTracking(): void {
  subscribeBusy((sessionId, _workspaceId, bBusy) => {
    if (!bBusy) {
      track(finishFollowUp(sessionId));
      return;
    }
    // busy=true re-fires on every subagent count update: start once per turn.
    if (followUps.has(sessionId) || startingFollowUps.has(sessionId)) return;
    const starting = startFollowUp(sessionId)
      .catch((err) => logger.warn({ err, sessionId }, 'Could not start a follow-up turn of an orchestrator step'))
      .finally(() => startingFollowUps.delete(sessionId));
    startingFollowUps.set(sessionId, starting);
    track(starting);
  });
}
