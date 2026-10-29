// classes
import { planUpdateTargetIndex } from '../sessionMessages';

// types
import type { ActiveRun, BusySubagents } from './types';

// --------------------------------------------- State ---------------------------------------------

export const activeRuns = new Map<string, ActiveRun>();
/** Background turn promises (resolve after cleanup), by session id. */
export const runCompletions = new Map<string, Promise<void>>();
const busySubscribers = new Set<
  (sessionId: string, workspaceId: string, busy: boolean, subagents?: BusySubagents | null) => void
>();

// --------------------------------------------- Functions ---------------------------------------------

export function getActiveSessionIds(): Set<string> {
  return new Set(activeRuns.keys());
}

export function getActiveBusySubagents(sessionId: string): BusySubagents | null {
  return activeRuns.get(sessionId)?.backgroundTasks ?? null;
}

export function getActiveRun(sessionId: string): ActiveRun | undefined {
  return activeRuns.get(sessionId);
}

/**
 * Mirror a persisted plan edit into the active run's message list; the run
 * rewrites this turn's rows from that list when it finishes.
 */
export function appendPlanUpdateToActiveRun(sessionId: string, line: string): void {
  const run = activeRuns.get(sessionId);
  if (!run) return;
  const targetIndex = planUpdateTargetIndex(run.messages);
  if (targetIndex < 0) {
    run.messages.push({ role: 'assistant', events: [line], createdAt: new Date().toISOString() });
    return;
  }
  const target = run.messages[targetIndex];
  target.events = [...(target.events ?? []), line];
}

export function isSessionBusy(sessionId: string): boolean {
  return activeRuns.has(sessionId);
}

export function subscribeBusy(
  handler: (
    sessionId: string,
    workspaceId: string,
    busy: boolean,
    subagents?: BusySubagents | null
  ) => void
): void {
  busySubscribers.add(handler);
}

export function unsubscribeBusy(
  handler: (
    sessionId: string,
    workspaceId: string,
    busy: boolean,
    subagents?: BusySubagents | null
  ) => void
): void {
  busySubscribers.delete(handler);
}

export function emitBusy(
  sessionId: string,
  workspaceId: string,
  busy: boolean,
  subagents?: BusySubagents | null
): void {
  for (const h of busySubscribers) {
    try {
      h(sessionId, workspaceId, busy, subagents ?? null);
    } catch {
      // ignore subscriber errors
    }
  }
}
