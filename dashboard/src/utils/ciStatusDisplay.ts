// types
import type { CiRun, CiStatusResponse, ForgeProvider } from '@/@types/index';

export function forgeProviderLabel(provider: ForgeProvider): string {
  switch (provider) {
    case 'github':
      return 'GitHub';
    case 'gitlab':
      return 'GitLab';
    case 'forgejo':
      return 'Forgejo';
    default:
      return 'Gitea';
  }
}

/** One state for compact badges: activity wins over the last finished result. */
export type CiBadgeState = 'running' | 'queued' | 'success' | 'failure' | 'cancelled' | 'none';

export function ciBadgeState(status: CiStatusResponse | null): CiBadgeState {
  if (!status?.repo || status.error) return 'none';
  if (status.running.length > 0) return 'running';
  if (status.queuedTotal > 0) return 'queued';
  switch (status.lastCompleted?.status) {
    case 'success':
      return 'success';
    case 'failure':
      return 'failure';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'none';
  }
}

export function ciBadgeTitle(status: CiStatusResponse | null): string {
  const state = ciBadgeState(status);
  const last = status?.lastCompleted;
  const lastLabel = last ? `last build ${ciRunLabel(last)} ${ciResultVerb(last)}` : '';
  switch (state) {
    case 'running':
      return `CI running${status && status.queuedTotal > 0 ? ` · ${status.queuedTotal} queued` : ''}`;
    case 'queued':
      return `CI queued (${status?.queuedTotal ?? 0})`;
    case 'none':
      return 'CI';
    default:
      return `CI: ${lastLabel}`;
  }
}

export function ciRunLabel(run: CiRun): string {
  return run.number !== null ? `#${run.number}` : run.title;
}

export function ciResultVerb(run: CiRun): string {
  switch (run.status) {
    case 'success':
      return 'passed';
    case 'failure':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'skipped':
      return 'skipped';
    case 'running':
      return 'running';
    case 'queued':
      return 'queued';
    default:
      return 'finished';
  }
}

/** Poll faster while something is in flight. */
export function ciPollIntervalMs(status: CiStatusResponse | null): number {
  const state = ciBadgeState(status);
  return state === 'running' || state === 'queued' ? 10_000 : 30_000;
}
