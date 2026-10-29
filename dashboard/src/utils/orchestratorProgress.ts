// utils
import { subtasksFromStoredJson } from '@/utils/orchestratorPayload';

// types
import type { Orchestrator, Session } from '@/@types/index';

/** Bell target for a step's "needs input" item; read once that step stops waiting. */
export function orchestratorInputTargetId(orchestratorId: string, stepIndex: number): string {
  return `${orchestratorId}:input:${stepIndex}`;
}

/**
 * Bell targets that count as read for this plan: the plan itself once its "Done"
 * mark is gone, and every step that is not waiting for an answer.
 */
export function orchestratorReadTargets(orchestrator: Pick<Orchestrator, 'id' | 'unread' | 'runStatus' | 'subtasksJson'>): string[] {
  const targets = orchestrator.unread ? [] : [orchestrator.id];
  subtasksFromStoredJson(orchestrator.subtasksJson).forEach((task, index) => {
    if (!(task.runResult === 'running' && task.waitingQuestion && orchestrator.runStatus === 'running')) {
      targets.push(orchestratorInputTargetId(orchestrator.id, index));
    }
  });
  return targets;
}

export interface OrchestratorProgress {
  total: number;
  /** Steps that finished well (done or skipped). */
  done: number;
  failed: number;
  /** Steps whose session works right now. */
  running: number;
  /** Running steps that wait for the user's answer to their agent's question. */
  waiting: number;
  /** The run is on, or any of its agents (steps or planning chat) is busy. */
  bRunning: boolean;
}

/** Step counts for the sidebar ring; the verify step counts like any other step. */
export function orchestratorProgress(
  orchestrator: Orchestrator,
  sessionsById: Map<string, Session>,
  bPlannerBusy = false
): OrchestratorProgress {
  const tasks = subtasksFromStoredJson(orchestrator.subtasksJson);
  let done = 0;
  let failed = 0;
  let running = 0;
  let waiting = 0;
  let bAnyStepBusy = false;
  for (const task of tasks) {
    if (task.runResult === 'done' || task.runResult === 'skipped') {
      done++;
    } else if (task.runResult === 'failed') {
      failed++;
    } else if (task.runResult === 'running' && task.waitingQuestion && orchestrator.runStatus === 'running') {
      waiting++;
    } else if (task.runResult === 'running') {
      running++;
    }
    if (task.sessionId && sessionsById.get(task.sessionId)?.busy) {
      bAnyStepBusy = true;
    }
  }
  return {
    total: tasks.length,
    done,
    failed,
    running,
    waiting,
    bRunning: orchestrator.runStatus === 'running' || bAnyStepBusy || bPlannerBusy
  };
}
