// classes
import { config } from './config';
import { db } from './database';
import { getCachedCiRuns, getForgeConnection } from './forge';
import { isActiveCiRun } from './forgeCi';
import { logger } from './logger';
import { sendPushToAll } from './push';

// types
import type { CiRun } from '@novacode/shared';

/**
 * Server-side CI watcher: polls repos someone recently looked at (or pushed from the
 * Git tab) and sends a `ci` Web Push when a run that was queued/running finishes —
 * so the notification arrives even with every browser tab closed.
 */

const TICK_MS = 15_000;
const FAST_POLL_MS = 20_000;
const IDLE_POLL_MS = 120_000;
/** After a push from the Git tab, poll fast until the new run shows up. */
const AFTER_PUSH_FAST_MS = 15 * 60_000;
/** Stop watching a repo nobody has looked at for this long (unless a run is still active). */
const INTEREST_TTL_MS = 6 * 60 * 60_000;

export interface CiWatchTarget {
  workspaceId: string;
  workspaceName: string;
  /** Repo path inside the workspace (`''` = root). */
  repoPath: string;
  /** Forge connection the repo resolved to. */
  connectionId: string;
  /** Repo path on that forge. */
  forgeRepo: string;
  branch: string | null;
  sha: string | null;
  /** Session the user was viewing — the notification deep-links back to its Git tab. */
  sessionId?: string | null;
}

interface CiWatch extends CiWatchTarget {
  lastInterestAt: number;
  fastUntil: number;
  nextPollAt: number;
  /** Runs seen queued/running, by id. `null` = not observed yet (no notifications for history). */
  active: Map<number, CiRun> | null;
}

const watches = new Map<string, CiWatch>();
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

function watchKey(workspaceId: string, repoPath: string): string {
  return `${workspaceId}|${repoPath}`;
}

export function touchCiWatch(target: CiWatchTarget): void {
  const key = watchKey(target.workspaceId, target.repoPath);
  const now = Date.now();
  const existing = watches.get(key);
  if (existing) {
    // A branch switch resets observed runs so the old branch's runs do not "finish".
    if (
      existing.branch !== target.branch ||
      existing.forgeRepo !== target.forgeRepo ||
      existing.connectionId !== target.connectionId
    ) {
      existing.active = null;
    }
    Object.assign(existing, target, {
      sessionId: target.sessionId ?? existing.sessionId,
      lastInterestAt: now
    });
    return;
  }
  watches.set(key, { ...target, lastInterestAt: now, fastUntil: 0, nextPollAt: now + FAST_POLL_MS, active: null });
}

export function markCiWatchPushed(workspaceId: string, repoPath: string): void {
  const watch = watches.get(watchKey(workspaceId, repoPath));
  if (!watch) return;
  const now = Date.now();
  watch.fastUntil = now + AFTER_PUSH_FAST_MS;
  watch.nextPollAt = now + 5_000;
  watch.lastInterestAt = now;
}

/** Diff the observed runs against the previous snapshot; returns runs that just finished. */
export function diffFinishedRuns(previous: Map<number, CiRun> | null, runs: CiRun[]): CiRun[] {
  if (!previous) return [];
  const byId = new Map(runs.map((run) => [run.id, run]));
  const finished: CiRun[] = [];
  for (const id of previous.keys()) {
    const run = byId.get(id);
    if (run && !isActiveCiRun(run) && run.status !== 'skipped' && run.status !== 'unknown') finished.push(run);
  }
  return finished;
}

/** Called by the status route and the poller with fresh runs for a watched target. */
export function observeCiRuns(workspaceId: string, repoPath: string, runs: CiRun[]): void {
  const watch = watches.get(watchKey(workspaceId, repoPath));
  if (!watch) return;
  const scoped = watch.branch ? runs.filter((run) => !run.branch || run.branch === watch.branch) : runs;
  const finished = diffFinishedRuns(watch.active, scoped);
  watch.active = new Map(scoped.filter(isActiveCiRun).map((run) => [run.id, run]));
  for (const run of finished) {
    void notifyRunFinished(watch, run);
  }
}

async function notifyRunFinished(watch: CiWatch, run: CiRun): Promise<void> {
  const verb = run.status === 'success' ? 'passed' : run.status === 'cancelled' ? 'cancelled' : 'failed';
  const label = run.number !== null ? `#${run.number} ` : '';
  const url = watch.sessionId
    ? `/workspace/${encodeURIComponent(watch.workspaceId)}/session/${encodeURIComponent(watch.sessionId)}?tab=git`
    : `/workspace/${encodeURIComponent(watch.workspaceId)}/git`;
  try {
    await sendPushToAll(
      {
        title: `Build ${verb}: ${watch.workspaceName}`,
        body: [watch.branch, `${label}${run.title}`].filter(Boolean).join(' · '),
        tag: `ci-${watch.workspaceId}-${run.id}`,
        url,
        actions: []
      },
      'ci'
    );
  } catch (err) {
    logger.warn({ err, workspaceId: watch.workspaceId, runId: run.id }, 'CI push notification failed');
  }
}

async function pollWatch(watch: CiWatch, now: number): Promise<void> {
  const connection = getForgeConnection(config.configDir, watch.connectionId);
  if (!connection) return;
  try {
    const result = await getCachedCiRuns(
      connection,
      watch.forgeRepo,
      { branch: watch.branch, sha: watch.sha },
      { maxAgeMs: FAST_POLL_MS / 2 }
    );
    observeCiRuns(watch.workspaceId, watch.repoPath, result.runs);
  } catch (err) {
    logger.debug({ err, repo: watch.forgeRepo }, 'CI watcher poll failed');
  }
  const fast = (watch.active?.size ?? 0) > 0 || now < watch.fastUntil;
  watch.nextPollAt = Date.now() + (fast ? FAST_POLL_MS : IDLE_POLL_MS);
}

async function tick(): Promise<void> {
  if (ticking || watches.size === 0) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const [key, watch] of watches) {
      if (now - watch.lastInterestAt > INTEREST_TTL_MS && (watch.active?.size ?? 0) === 0) {
        watches.delete(key);
      }
    }
    // Polling only feeds notifications — skip it when no device wants CI pushes.
    if (!(await db.hasCiPushSubscriptions())) return;
    const due = [...watches.values()].filter((watch) => now >= watch.nextPollAt);
    await Promise.all(due.map((watch) => pollWatch(watch, now)));
  } catch (err) {
    logger.warn({ err }, 'CI watcher tick failed');
  } finally {
    ticking = false;
  }
}

export function startCiWatcher(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
}

export function stopCiWatcher(): void {
  if (timer) clearInterval(timer);
  timer = null;
  watches.clear();
}
