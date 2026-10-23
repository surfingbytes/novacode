// utils
import { subtasksFromStoredJson } from '@/utils/orchestratorPayload';

// types
import type { Orchestrator, Session } from '@/@types/index';

export interface OrchestratorProgress {
  total: number;
  /** Steps that finished well (done or skipped). */
  done: number;
  failed: number;
  /** Steps whose session works right now. */
  running: number;
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
  let bAnyStepBusy = false;
  for (const task of tasks) {
    if (task.runResult === 'done' || task.runResult === 'skipped') {
      done++;
    } else if (task.runResult === 'failed') {
      failed++;
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
    bRunning: orchestrator.runStatus === 'running' || bAnyStepBusy || bPlannerBusy
  };
}
