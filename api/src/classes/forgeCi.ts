// types
import type { CiRun, CiRunStatus, CiStatusResponse } from '@novacode/shared';

/**
 * Provider-neutral CI helpers: map Gitea/Forgejo/GitHub runs and GitLab pipelines to
 * `CiRun`, summarize them for the UI, and build the "fix failed build" prompt.
 */

export const CI_QUEUED_DISPLAY_LIMIT = 3;
const LOG_TAIL_LINES = 150;
const LOG_TAIL_MAX_CHARS = 12_000;

export interface CiRunsResult {
  source: 'actions' | 'commit-status';
  runs: CiRun[];
}

export interface FailedJobLog {
  name: string;
  log: string | null;
  /** Failed step names (Actions) or the job's stage (GitLab). */
  failedSteps?: string[];
}

export function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** GitHub-style runs/jobs (`status` + `conclusion`) and Forgejo/commit-status single states. */
export function normalizeCiStatus(status: unknown, conclusion: unknown): CiRunStatus {
  const s = typeof status === 'string' ? status.toLowerCase() : '';
  const c = typeof conclusion === 'string' ? conclusion.toLowerCase() : '';
  if (s === 'completed') {
    if (c === 'success' || c === 'neutral') return 'success';
    if (c === 'cancelled') return 'cancelled';
    if (c === 'skipped') return 'skipped';
    if (c === 'failure' || c === 'timed_out' || c === 'action_required' || c === 'startup_failure') return 'failure';
    return 'unknown';
  }
  switch (s) {
    case 'success':
      return 'success';
    case 'failure':
    case 'error':
      return 'failure';
    case 'cancelled':
      return 'cancelled';
    case 'skipped':
      return 'skipped';
    case 'running':
    case 'in_progress':
      return 'running';
    case 'waiting':
    case 'queued':
    case 'pending':
    case 'blocked':
    case 'requested':
      return 'queued';
    default:
      return 'unknown';
  }
}

/** GitLab pipeline/job statuses. `manual` waits on a human, so it is neither queued nor done. */
export function normalizeGitlabStatus(status: unknown): CiRunStatus {
  switch (typeof status === 'string' ? status.toLowerCase() : '') {
    case 'success':
      return 'success';
    case 'failed':
      return 'failure';
    case 'canceled':
    case 'cancelled':
      return 'cancelled';
    case 'skipped':
      return 'skipped';
    case 'running':
    case 'canceling':
      return 'running';
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
    case 'pending':
    case 'scheduled':
    case 'waiting_for_callback':
      return 'queued';
    default:
      return 'unknown';
  }
}

export function absoluteUrl(url: string | null, baseUrl: string): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return url.startsWith('/') ? `${baseUrl}${url}` : null;
}

/** Gitea/GitHub run (`head_branch`, `conclusion`) or Forgejo run (`prettyref`, `commit_sha`). */
export function normalizeActionsRun(raw: unknown, webUrl: string): CiRun | null {
  const r = asRecord(raw);
  const id = num(r?.id);
  if (!r || id === null) return null;
  const branchRaw = str(r.head_branch) ?? str(r.prettyref);
  return {
    id,
    number: num(r.run_number) ?? num(r.index_in_repo),
    title: str(r.display_title) ?? str(r.title) ?? str(r.name) ?? str(r.path) ?? `Run ${id}`,
    status: normalizeCiStatus(r.status, r.conclusion),
    branch: branchRaw ? branchRaw.replace(/^refs\/heads\//, '') : null,
    sha: str(r.head_sha) ?? str(r.commit_sha),
    event: str(r.event) ?? str(r.trigger_event),
    url: absoluteUrl(str(r.html_url), webUrl),
    createdAt: str(r.created_at) ?? str(r.created) ?? str(r.run_started_at),
    updatedAt: str(r.updated_at) ?? str(r.updated) ?? str(r.completed_at) ?? str(r.stopped)
  };
}

export function normalizeGitlabPipeline(raw: unknown): CiRun | null {
  const r = asRecord(raw);
  const id = num(r?.id);
  if (!r || id === null) return null;
  const iid = num(r.iid);
  return {
    id,
    number: iid,
    title: str(r.name) ?? `Pipeline #${iid ?? id}`,
    status: normalizeGitlabStatus(r.status),
    branch: str(r.ref),
    sha: str(r.sha),
    event: str(r.source),
    url: str(r.web_url),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at)
  };
}

/** Commit statuses (Woodpecker, Drone, older Gitea, GitHub statuses) as pseudo-runs, newest first. */
export function commitStatusesToRuns(raw: unknown, webUrl: string, branch: string | null): CiRun[] {
  const combined = asRecord(raw);
  if (!combined) return [];
  const statuses = Array.isArray(combined.statuses) ? combined.statuses : [];
  const sha = str(combined.sha);
  const runs: CiRun[] = [];
  for (const entry of statuses) {
    const s = asRecord(entry);
    const id = num(s?.id);
    if (!s || id === null) continue;
    const state = normalizeCiStatus(s.status ?? s.state, null);
    runs.push({
      id,
      number: null,
      title: str(s.context) ?? str(s.description) ?? `Status ${id}`,
      // Commit statuses have no queue — pending means in progress.
      status: state === 'queued' ? 'running' : state,
      branch,
      sha,
      event: null,
      url: absoluteUrl(str(s.target_url), webUrl),
      createdAt: str(s.created_at),
      updatedAt: str(s.updated_at)
    });
  }
  return runs.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

const TERMINAL: ReadonlySet<CiRunStatus> = new Set(['success', 'failure', 'cancelled', 'skipped', 'unknown']);

export function isActiveCiRun(run: CiRun): boolean {
  return run.status === 'running' || run.status === 'queued';
}

/** `runs` newest-first. Skipped/unknown runs only count as "last" when nothing else finished. */
export function summarizeCiRuns(
  runs: CiRun[],
  branch: string | null
): Pick<CiStatusResponse, 'lastCompleted' | 'running' | 'queued' | 'queuedTotal'> {
  const scoped = branch ? runs.filter((run) => !run.branch || run.branch === branch) : runs;
  const finished = scoped.filter((run) => TERMINAL.has(run.status));
  const lastCompleted =
    finished.find((run) => run.status !== 'skipped' && run.status !== 'unknown') ?? finished[0] ?? null;
  const running = scoped.filter((run) => run.status === 'running');
  const queuedAll = scoped.filter((run) => run.status === 'queued').reverse();
  return {
    lastCompleted,
    running,
    queued: queuedAll.slice(0, CI_QUEUED_DISPLAY_LIMIT),
    queuedTotal: queuedAll.length
  };
}

// -------------------------------------------------- Fix-build prompt --------------------------------------------------

/** Drops ANSI codes, GitLab section markers and runner timestamp prefixes. */
export function cleanJobLog(log: string): string {
  return log
    .replace(/section_(?:start|end):\d+:[^\r\n]*\r?/g, '')
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\r(?!\n)/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s?/, '').trimEnd())
    .join('\n');
}

export function tailLog(log: string, maxLines = LOG_TAIL_LINES, maxChars = LOG_TAIL_MAX_CHARS): string {
  const lines = log.replace(/\n+$/, '').split('\n');
  let tail = lines.slice(-maxLines).join('\n');
  if (tail.length > maxChars) tail = tail.slice(tail.length - maxChars);
  return tail;
}

function fenceFor(content: string): string {
  let fence = '```';
  while (content.includes(fence)) fence += '`';
  return fence;
}

export function buildFixBuildPrompt(input: {
  repo: string;
  branch: string | null;
  run: CiRun | null;
  runUrl: string | null;
  jobs: FailedJobLog[];
}): string {
  const { run, branch } = input;
  const parts: string[] = [];
  parts.push(`The CI build for ${branch ? `branch \`${branch}\`` : 'this commit'} of \`${input.repo}\` failed.`);
  const details: string[] = [];
  if (run) {
    const label = run.number !== null ? `#${run.number} ` : '';
    const meta = [run.event, run.sha ? `commit ${run.sha.slice(0, 10)}` : null].filter(Boolean).join(', ');
    details.push(`- Run: ${label}"${run.title}"${meta ? ` (${meta})` : ''}`);
  }
  if (input.runUrl) details.push(`- Link: ${input.runUrl}`);
  if (details.length) parts.push(details.join('\n'));

  const jobLabel = (job: FailedJobLog): string =>
    `\`${job.name}\`${job.failedSteps?.length ? ` (failed step: ${job.failedSteps.join(', ')})` : ''}`;
  const withLogs = input.jobs.filter((job) => job.log);
  for (const job of withLogs) {
    const log = job.log ?? '';
    const fence = fenceFor(log);
    parts.push(`Failed job ${jobLabel(job)} — end of the log:\n${fence}text\n${log}\n${fence}`);
  }
  const withoutLogs = input.jobs.filter((job) => !job.log).map(jobLabel);
  if (withoutLogs.length) parts.push(`Logs were unavailable for failed job(s): ${withoutLogs.join(', ')}.`);
  if (input.jobs.length === 0) {
    parts.push('Job logs could not be fetched automatically — open the link above (or use a forge MCP tool) to read them.');
  }
  parts.push(
    'Find the root cause, fix it in the code, and verify the fix locally by running the failing step if possible. Do not push unless I ask.'
  );
  return parts.join('\n\n');
}
