// node_modules
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// classes
import { logger } from './logger';

// types
import type {
  CiRun,
  CiRunStatus,
  CiStatusResponse,
  ForgeConnectionTestResult,
  ForgeProvider,
  ForgeSettingsStatus
} from '@novacode/shared';

/**
 * Gitea / Forgejo integration. Both expose the same `/api/v1` REST API (token auth,
 * Actions runs, commit statuses); differences are normalized here so routes and the
 * dashboard only see `CiRun`.
 */

const FORGE_FILE = 'forge.json';
const REQUEST_TIMEOUT_MS = 10_000;
/** Runs fetched per poll — enough to find the last finished run behind a queue. */
const RUNS_PAGE_SIZE = 30;
export const CI_QUEUED_DISPLAY_LIMIT = 3;
const ACTIVE_CACHE_TTL_MS = 10_000;
const IDLE_CACHE_TTL_MS = 30_000;
const ERROR_CACHE_TTL_MS = 30_000;
const LOG_TAIL_LINES = 150;
const LOG_TAIL_MAX_CHARS = 12_000;
const MAX_FAILED_JOB_LOGS = 3;
/** Public hosts a self-hosted forge never serves — skip auto-detect for them. */
const PUBLIC_GIT_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org']);

export interface ForgeCredentials {
  url: string;
  token: string;
  source: 'env' | 'file';
}

interface StoredForgeFile {
  url?: unknown;
  token?: unknown;
  provider?: unknown;
  version?: unknown;
}

export class ForgeHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

// -------------------------------------------------- Settings --------------------------------------------------

/** Strip trailing slashes and an `/api/v1` suffix users often paste. */
export function normalizeForgeUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  url = url.replace(/\/api\/v1$/i, '');
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('Forge URL must start with http:// or https://');
  }
  return url;
}

function forgeFilePath(configDir: string): string {
  return join(configDir, FORGE_FILE);
}

function readForgeFile(configDir: string): StoredForgeFile | null {
  const path = forgeFilePath(configDir);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as StoredForgeFile) : null;
  } catch {
    return null;
  }
}

/** Env (`FORGE_URL` + `FORGE_TOKEN`) wins over the Settings file. */
export function resolveForgeCredentials(configDir: string): ForgeCredentials | null {
  const envUrl = (process.env['FORGE_URL'] ?? '').trim();
  const envToken = (process.env['FORGE_TOKEN'] ?? '').trim();
  if (envUrl && envToken) {
    try {
      return { url: normalizeForgeUrl(envUrl), token: envToken, source: 'env' };
    } catch {
      logger.warn({ url: envUrl }, 'Ignoring invalid FORGE_URL');
    }
  }
  const file = readForgeFile(configDir);
  const url = typeof file?.url === 'string' ? file.url.trim() : '';
  const token = typeof file?.token === 'string' ? file.token.trim() : '';
  if (!url || !token) return null;
  return { url, token, source: 'file' };
}

function isForgeProvider(value: unknown): value is ForgeProvider {
  return value === 'gitea' || value === 'forgejo';
}

export function getForgeSettingsStatus(configDir: string): ForgeSettingsStatus {
  const creds = resolveForgeCredentials(configDir);
  if (!creds) {
    return { configured: false, source: null, url: null, provider: null, version: null };
  }
  // Provider/version are captured on save; env-only setups learn them from the cache.
  const file = readForgeFile(configDir);
  const sameUrl = typeof file?.url === 'string' && file.url === creds.url;
  const detected = detectedServer.get(creds.url);
  return {
    configured: true,
    source: creds.source,
    url: creds.url,
    provider: detected?.provider ?? (sameUrl && isForgeProvider(file?.provider) ? file.provider : null),
    version: detected?.version ?? (sameUrl && typeof file?.version === 'string' ? file.version : null)
  };
}

/** `token` may be omitted to keep the stored one (e.g. when only the URL changes). */
export function saveForgeSettings(
  configDir: string,
  input: { url: string; token?: string; provider?: ForgeProvider; version?: string }
): void {
  const url = normalizeForgeUrl(input.url);
  const token = input.token?.trim() || resolveStoredToken(configDir);
  if (!token) {
    throw new Error('Access token is required');
  }
  const data: StoredForgeFile = { url, token };
  if (input.provider) data.provider = input.provider;
  if (input.version) data.version = input.version;
  writeFileSync(forgeFilePath(configDir), `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  clearForgeCaches();
}

export function clearForgeSettings(configDir: string): void {
  rmSync(forgeFilePath(configDir), { force: true });
  clearForgeCaches();
}

function resolveStoredToken(configDir: string): string {
  const file = readForgeFile(configDir);
  return typeof file?.token === 'string' ? file.token.trim() : '';
}

/** Token for a connection test: the typed one, else the stored one. */
export function resolveTestToken(configDir: string, token: string | undefined): string {
  return token?.trim() || resolveForgeCredentials(configDir)?.token || '';
}

// -------------------------------------------------- HTTP --------------------------------------------------

async function forgeRequest(
  creds: Pick<ForgeCredentials, 'url' | 'token'>,
  path: string,
  accept: 'json' | 'text' = 'json'
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${creds.url}/api/v1${path}`, {
      headers: {
        Authorization: `token ${creds.token}`,
        Accept: accept === 'json' ? 'application/json' : 'text/plain'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'TimeoutError'
        ? 'Forge did not respond in time'
        : `Cannot reach forge: ${err instanceof Error ? err.message : 'network error'}`;
    throw new ForgeHttpError(0, message);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    let detail = '';
    try {
      const parsed = JSON.parse(body) as { message?: unknown };
      if (typeof parsed.message === 'string') detail = parsed.message;
    } catch {
      detail = body.slice(0, 200);
    }
    const message =
      response.status === 401
        ? 'Forge rejected the access token'
        : response.status === 403
          ? 'Access token lacks permission for this request'
          : detail.trim() || `Forge API error ${response.status}`;
    throw new ForgeHttpError(response.status, message);
  }
  return accept === 'json' ? response.json() : response.text();
}

function forgeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Forge request failed';
}

// -------------------------------------------------- Connection test --------------------------------------------------

const detectedServer = new Map<string, { provider: ForgeProvider; version: string }>();

/** Forgejo reports e.g. `11.0.1+gitea-1.22.0`; plain Gitea reports `1.24.3`. */
export function detectForgeProvider(version: string): ForgeProvider {
  return /\+gitea/i.test(version) ? 'forgejo' : 'gitea';
}

export async function testForgeConnection(rawUrl: string, token: string): Promise<ForgeConnectionTestResult> {
  let url: string;
  try {
    url = normalizeForgeUrl(rawUrl);
  } catch (err) {
    return { ok: false, error: forgeErrorMessage(err) };
  }
  if (!token.trim()) {
    return { ok: false, error: 'Access token is required' };
  }
  const creds = { url, token: token.trim() };
  try {
    const versionJson = (await forgeRequest(creds, '/version')) as { version?: unknown };
    const version = typeof versionJson.version === 'string' ? versionJson.version : '';
    if (!version) {
      return { ok: false, error: 'URL does not look like a Gitea or Forgejo server' };
    }
    const user = (await forgeRequest(creds, '/user')) as { login?: unknown; username?: unknown };
    const username =
      typeof user.login === 'string' ? user.login : typeof user.username === 'string' ? user.username : undefined;
    const provider = detectForgeProvider(version);
    detectedServer.set(url, { provider, version });
    return { ok: true, provider, version, username };
  } catch (err) {
    return { ok: false, error: forgeErrorMessage(err) };
  }
}

// -------------------------------------------------- Repo detection --------------------------------------------------

/** Parses scp-style (`git@host:owner/repo.git`) and URL remotes into host + `owner/name`. */
export function parseGitRemote(remote: string): { host: string; repo: string } | null {
  const trimmed = remote.trim();
  if (!trimmed) return null;
  let host: string;
  let path: string;
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/\/)(.+)$/.exec(trimmed);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    host = scp[1];
    path = scp[2];
  } else {
    try {
      const parsed = new URL(trimmed);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return null;
    }
  }
  // Last two segments — forges may be served under a sub-path (`https://host/git/owner/repo`).
  const segments = path
    .replace(/\.git\/?$/, '')
    .split('/')
    .filter(Boolean);
  if (segments.length < 2) return null;
  const repo = `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
  return { host: host.toLowerCase(), repo };
}

/**
 * `owner/name` for a remote, or null when the remote clearly points elsewhere. Remote and
 * API hosts often differ for self-hosted setups (SSH domain vs internal HTTP name), so a
 * host mismatch alone does not disqualify — only well-known public hosts do.
 */
export function forgeRepoFromRemote(remote: string, forgeUrl: string): string | null {
  const parsed = parseGitRemote(remote);
  if (!parsed) return null;
  let forgeHost = '';
  try {
    forgeHost = new URL(forgeUrl).hostname.toLowerCase();
  } catch {
    // keep empty
  }
  if (PUBLIC_GIT_HOSTS.has(parsed.host) && parsed.host !== forgeHost) return null;
  return parsed.repo;
}

const REPO_NAME_RE = /^[\w.-]+\/[\w.-]+$/;

/** Accepts `owner/name`, a full repo URL, or a clone URL. Returns null for blank input. */
export function normalizeForgeRepoInput(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  if (REPO_NAME_RE.test(value)) return value.replace(/\.git$/, '');
  const parsed = parseGitRemote(value);
  if (parsed && REPO_NAME_RE.test(parsed.repo)) return parsed.repo;
  throw new Error('Forge repository must look like owner/name');
}

// -------------------------------------------------- Runs --------------------------------------------------

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeCiStatus(status: unknown, conclusion: unknown): CiRunStatus {
  const s = typeof status === 'string' ? status.toLowerCase() : '';
  const c = typeof conclusion === 'string' ? conclusion.toLowerCase() : '';
  // Gitea (GitHub-style): status = queued|in_progress|completed, result in conclusion.
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

function absoluteUrl(url: string | null, forgeUrl: string): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return url.startsWith('/') ? `${forgeUrl}${url}` : null;
}

/** Normalizes a Gitea (`head_branch`, `conclusion`) or Forgejo (`prettyref`, `commit_sha`) run. */
export function normalizeCiRun(raw: unknown, forgeUrl: string): CiRun | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = num(r.id);
  if (id === null) return null;
  const branchRaw = str(r.head_branch) ?? str(r.prettyref);
  return {
    id,
    number: num(r.run_number) ?? num(r.index_in_repo),
    title: str(r.display_title) ?? str(r.title) ?? str(r.name) ?? str(r.path) ?? `Run ${id}`,
    status: normalizeCiStatus(r.status, r.conclusion),
    branch: branchRaw ? branchRaw.replace(/^refs\/heads\//, '') : null,
    sha: str(r.head_sha) ?? str(r.commit_sha),
    event: str(r.event) ?? str(r.trigger_event),
    url: absoluteUrl(str(r.html_url), forgeUrl),
    createdAt: str(r.created_at) ?? str(r.created) ?? str(r.run_started_at),
    updatedAt: str(r.updated_at) ?? str(r.updated) ?? str(r.completed_at) ?? str(r.stopped)
  };
}

const TERMINAL: ReadonlySet<CiRunStatus> = new Set(['success', 'failure', 'cancelled', 'skipped', 'unknown']);

export function isActiveCiRun(run: CiRun): boolean {
  return run.status === 'running' || run.status === 'queued';
}

/** `runs` newest-first. Skipped runs only count as "last" when nothing else finished. */
export function summarizeCiRuns(
  runs: CiRun[],
  branch: string | null
): Pick<CiStatusResponse, 'lastCompleted' | 'running' | 'queued' | 'queuedTotal'> {
  const scoped = branch ? runs.filter((run) => !run.branch || run.branch === branch) : runs;
  const finished = scoped.filter((run) => TERMINAL.has(run.status));
  const lastCompleted = finished.find((run) => run.status !== 'skipped') ?? finished[0] ?? null;
  const running = scoped.filter((run) => run.status === 'running');
  const queuedAll = scoped.filter((run) => run.status === 'queued').reverse();
  return {
    lastCompleted,
    running,
    queued: queuedAll.slice(0, CI_QUEUED_DISPLAY_LIMIT),
    queuedTotal: queuedAll.length
  };
}

/** Commit statuses (Woodpecker, Drone, older Gitea) mapped to pseudo-runs, newest first. */
export function commitStatusesToRuns(raw: unknown, forgeUrl: string, branch: string | null): CiRun[] {
  if (!raw || typeof raw !== 'object') return [];
  const combined = raw as Record<string, unknown>;
  const statuses = Array.isArray(combined.statuses) ? combined.statuses : [];
  const sha = str(combined.sha);
  const runs: CiRun[] = [];
  for (const entry of statuses) {
    if (!entry || typeof entry !== 'object') continue;
    const s = entry as Record<string, unknown>;
    const id = num(s.id);
    if (id === null) continue;
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
      url: absoluteUrl(str(s.target_url), forgeUrl),
      createdAt: str(s.created_at),
      updatedAt: str(s.updated_at)
    });
  }
  return runs.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

export interface CiRunsResult {
  source: 'actions' | 'commit-status';
  runs: CiRun[];
}

function repoPath(repo: string): string {
  const [owner, name] = repo.split('/');
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/** Actions runs; falls back to commit statuses when Actions is unavailable or unused. */
export async function fetchCiRuns(
  creds: Pick<ForgeCredentials, 'url' | 'token'>,
  repo: string,
  ref: { branch: string | null; sha: string | null }
): Promise<CiRunsResult> {
  const base = repoPath(repo);
  const params = new URLSearchParams({ limit: String(RUNS_PAGE_SIZE), page: '1' });
  if (ref.branch) params.set('branch', ref.branch);
  let actionsError: unknown = null;
  try {
    const json = (await forgeRequest(creds, `${base}/actions/runs?${params}`)) as { workflow_runs?: unknown };
    const list = Array.isArray(json.workflow_runs) ? json.workflow_runs : [];
    const runs = list
      .map((raw) => normalizeCiRun(raw, creds.url))
      .filter((run): run is CiRun => run !== null);
    const scoped = ref.branch ? runs.filter((run) => !run.branch || run.branch === ref.branch) : runs;
    if (scoped.length > 0) return { source: 'actions', runs };
  } catch (err) {
    // 404 = Actions API missing (older server) or disabled — try commit statuses.
    if (!(err instanceof ForgeHttpError) || (err.status !== 404 && err.status !== 403)) throw err;
    actionsError = err;
  }

  const commitRef = ref.branch ?? ref.sha;
  if (!commitRef) return { source: 'actions', runs: [] };
  try {
    const json = await forgeRequest(creds, `${base}/commits/${encodeURIComponent(commitRef)}/status`);
    return { source: 'commit-status', runs: commitStatusesToRuns(json, creds.url, ref.branch) };
  } catch (err) {
    if (err instanceof ForgeHttpError && err.status === 404) {
      // Branch not pushed yet — the repo exists if Actions answered.
      if (!actionsError) return { source: 'actions', runs: [] };
      throw new ForgeHttpError(404, `Repository ${repo} not found on the forge (or the token cannot see it)`);
    }
    throw err;
  }
}

// -------------------------------------------------- Cached status --------------------------------------------------

interface CacheEntry {
  at: number;
  ttl: number;
  promise: Promise<CiRunsResult>;
}

const runsCache = new Map<string, CacheEntry>();

export function clearForgeCaches(): void {
  runsCache.clear();
  detectedServer.clear();
}

/** Deduplicates concurrent polls (Git tab, header badge, watcher) for the same repo + ref. */
export async function getCachedCiRuns(
  creds: ForgeCredentials,
  repo: string,
  ref: { branch: string | null; sha: string | null },
  opts?: { maxAgeMs?: number }
): Promise<CiRunsResult> {
  const key = `${creds.url}|${repo}|${ref.branch ?? ''}|${ref.branch ? '' : (ref.sha ?? '')}`;
  const now = Date.now();
  const cached = runsCache.get(key);
  const maxAge = opts?.maxAgeMs;
  if (cached && now - cached.at < (maxAge !== undefined ? Math.min(maxAge, cached.ttl) : cached.ttl)) {
    return cached.promise;
  }
  const entry: CacheEntry = { at: now, ttl: IDLE_CACHE_TTL_MS, promise: fetchCiRuns(creds, repo, ref) };
  runsCache.set(key, entry);
  try {
    const result = await entry.promise;
    entry.ttl = result.runs.some(isActiveCiRun) ? ACTIVE_CACHE_TTL_MS : IDLE_CACHE_TTL_MS;
    return result;
  } catch (err) {
    entry.ttl = ERROR_CACHE_TTL_MS;
    throw err;
  }
}

export function forgeRepoUrl(forgeUrl: string, repo: string): string {
  return `${forgeUrl}/${repo}`;
}

// -------------------------------------------------- Fix-build prompt --------------------------------------------------

/** Drops ANSI codes and the ISO timestamp prefix Gitea runners add to each log line. */
export function cleanJobLog(log: string): string {
  return log
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
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

interface FailedJobLog {
  name: string;
  log: string | null;
  /** Names of failed steps, when the forge reports steps. */
  failedSteps?: string[];
}

function failedStepNames(job: Record<string, unknown>): string[] {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  return steps
    .map((step) => (step && typeof step === 'object' ? (step as Record<string, unknown>) : null))
    .filter((step): step is Record<string, unknown> => step !== null)
    .filter((step) => normalizeCiStatus(step.status, step.conclusion) === 'failure')
    .map((step) => str(step.name))
    .filter((name): name is string => name !== null);
}

async function fetchFailedJobLogs(
  creds: Pick<ForgeCredentials, 'url' | 'token'>,
  repo: string,
  runId: number
): Promise<FailedJobLog[]> {
  const base = repoPath(repo);
  const json = (await forgeRequest(creds, `${base}/actions/runs/${runId}/jobs?limit=50`)) as { jobs?: unknown };
  const jobs = Array.isArray(json.jobs) ? json.jobs : [];
  const failed = jobs
    .map((raw) => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null))
    .filter((job): job is Record<string, unknown> => job !== null)
    .filter((job) => normalizeCiStatus(job.status, job.conclusion) === 'failure')
    .slice(0, MAX_FAILED_JOB_LOGS);
  return Promise.all(
    failed.map(async (job) => {
      const name = str(job.name) ?? `Job ${String(job.id)}`;
      const failedSteps = failedStepNames(job);
      const jobId = num(job.id);
      if (jobId === null) return { name, log: null, failedSteps };
      try {
        const log = (await forgeRequest(creds, `${base}/actions/jobs/${jobId}/logs`, 'text')) as string;
        return { name, log: tailLog(cleanJobLog(log)), failedSteps };
      } catch {
        return { name, log: null, failedSteps };
      }
    })
  );
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
  if (withLogs.length === 0 && input.jobs.length === 0) {
    parts.push('Job logs could not be fetched automatically — open the link above (or use a forge MCP tool) to read them.');
  }
  parts.push(
    'Find the root cause, fix it in the code, and verify the fix locally by running the failing step if possible. Do not push unless I ask.'
  );
  return parts.join('\n\n');
}

export async function buildFixPromptForRun(
  creds: ForgeCredentials,
  repo: string,
  branch: string | null,
  run: CiRun | null,
  source: 'actions' | 'commit-status',
  runId: number
): Promise<{ prompt: string; includesLogs: boolean }> {
  let jobs: FailedJobLog[] = [];
  if (source === 'actions') {
    try {
      jobs = await fetchFailedJobLogs(creds, repo, runId);
    } catch (err) {
      // Forgejo and older Gitea have no jobs/logs API — the prompt links to the run instead.
      logger.debug({ err, repo, runId }, 'Forge job logs unavailable');
    }
  }
  const runUrl = run?.url ?? (source === 'actions' ? `${forgeRepoUrl(creds.url, repo)}/actions/runs/${runId}` : null);
  return {
    prompt: buildFixBuildPrompt({ repo, branch, run, runUrl, jobs }),
    includesLogs: jobs.some((job) => job.log)
  };
}
