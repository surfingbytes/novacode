// classes
import {
  asRecord,
  cleanJobLog,
  commitStatusesToRuns,
  normalizeActionsRun,
  normalizeCiStatus,
  normalizeGitlabPipeline,
  num,
  str,
  tailLog
} from './forgeCi';

// types
import type { CiRun, ForgeProvider } from '@novacode/shared';
import type { CiRunsResult, FailedJobLog } from './forgeCi';

/**
 * REST clients per provider. Gitea, Forgejo and GitHub share the Actions-style API
 * (`/repos/{owner}/{repo}/actions/runs`, combined commit status); GitLab uses pipelines.
 */

const REQUEST_TIMEOUT_MS = 10_000;
/** Runs fetched per poll — enough to find the last finished run behind a queue. */
const RUNS_PAGE_SIZE = 30;
const MAX_FAILED_JOB_LOGS = 3;

export interface ForgeEndpoint {
  provider: ForgeProvider;
  /** Web URL without trailing slash. */
  url: string;
  token: string;
}

export interface ForgeRef {
  branch: string | null;
  sha: string | null;
}

export interface ForgeClient {
  test(): Promise<{ provider: ForgeProvider; version?: string; username?: string }>;
  fetchRuns(repo: string, ref: ForgeRef): Promise<CiRunsResult>;
  fetchFailedJobLogs(repo: string, runId: number): Promise<FailedJobLog[]>;
  repoUrl(repo: string): string;
  runsUrl(repo: string, source: CiRunsResult['source']): string;
  runUrl(repo: string, runId: number): string;
}

export class ForgeHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export function providerLabel(provider: ForgeProvider): string {
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

async function request(
  url: string,
  headers: Record<string, string>,
  provider: ForgeProvider,
  accept: 'json' | 'text' = 'json'
): Promise<unknown> {
  const label = providerLabel(provider);
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'TimeoutError'
        ? `${label} did not respond in time`
        : `Cannot reach ${label}: ${err instanceof Error ? err.message : 'network error'}`;
    throw new ForgeHttpError(0, message);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    let detail = '';
    try {
      const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
      detail = typeof parsed.message === 'string' ? parsed.message : typeof parsed.error === 'string' ? parsed.error : '';
    } catch {
      detail = body.slice(0, 200);
    }
    const message =
      response.status === 401
        ? `${label} rejected the access token`
        : response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0'
          ? `${label} API rate limit exceeded`
          : response.status === 403
            ? 'Access token lacks permission for this request'
            : detail.trim() || `${label} API error ${response.status}`;
    throw new ForgeHttpError(response.status, message);
  }
  return accept === 'json' ? response.json() : response.text();
}

function ownerRepoPath(repo: string): string {
  const segments = repo.split('/');
  const owner = segments[0] ?? '';
  const name = segments[segments.length - 1] ?? '';
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function failedStepNames(job: Record<string, unknown>): string[] {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  return steps
    .map(asRecord)
    .filter((step): step is Record<string, unknown> => step !== null)
    .filter((step) => normalizeCiStatus(step.status, step.conclusion) === 'failure')
    .map((step) => str(step.name))
    .filter((name): name is string => name !== null);
}

// -------------------------------------------------- Actions-style (Gitea, Forgejo, GitHub) --------------------------------------------------

interface ActionsApi {
  provider: ForgeProvider;
  webUrl: string;
  get(path: string, accept?: 'json' | 'text'): Promise<unknown>;
}

async function fetchActionsRuns(api: ActionsApi, repo: string, ref: ForgeRef): Promise<CiRunsResult> {
  const base = ownerRepoPath(repo);
  // Gitea/Forgejo page with `limit`, GitHub with `per_page`; each ignores the other.
  const params = new URLSearchParams({ limit: String(RUNS_PAGE_SIZE), per_page: String(RUNS_PAGE_SIZE), page: '1' });
  if (ref.branch) params.set('branch', ref.branch);
  else if (ref.sha) params.set('head_sha', ref.sha);
  let actionsError: unknown = null;
  try {
    const json = asRecord(await api.get(`${base}/actions/runs?${params}`));
    const list = Array.isArray(json?.workflow_runs) ? json.workflow_runs : [];
    const runs = list
      .map((raw) => normalizeActionsRun(raw, api.webUrl))
      .filter((run): run is CiRun => run !== null);
    const scoped = ref.branch ? runs.filter((run) => !run.branch || run.branch === ref.branch) : runs;
    if (scoped.length > 0) return { source: 'actions', runs };
  } catch (err) {
    // 404/403 = Actions API missing (older server) or disabled — try commit statuses.
    if (!(err instanceof ForgeHttpError) || (err.status !== 404 && err.status !== 403)) throw err;
    if (err.status === 403 && /rate limit/i.test(err.message)) throw err;
    actionsError = err;
  }

  const commitRef = ref.branch ?? ref.sha;
  if (!commitRef) return { source: 'actions', runs: [] };
  try {
    const json = await api.get(`${base}/commits/${encodeURIComponent(commitRef)}/status`);
    return { source: 'commit-status', runs: commitStatusesToRuns(json, api.webUrl, ref.branch) };
  } catch (err) {
    if (err instanceof ForgeHttpError && (err.status === 404 || err.status === 422)) {
      // Branch not pushed yet — the repo exists if Actions answered.
      if (!actionsError) return { source: 'actions', runs: [] };
      throw new ForgeHttpError(404, `Repository ${repo} not found on ${providerLabel(api.provider)} (or the token cannot see it)`);
    }
    throw err;
  }
}

async function fetchActionsFailedJobLogs(api: ActionsApi, repo: string, runId: number): Promise<FailedJobLog[]> {
  const base = ownerRepoPath(repo);
  const json = asRecord(await api.get(`${base}/actions/runs/${runId}/jobs?limit=50&per_page=50`));
  const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
  const failed = jobs
    .map(asRecord)
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
        // GitHub answers with a redirect to signed storage; fetch drops auth cross-origin.
        const log = (await api.get(`${base}/actions/jobs/${jobId}/logs`, 'text')) as string;
        return { name, log: tailLog(cleanJobLog(log)), failedSteps };
      } catch {
        return { name, log: null, failedSteps };
      }
    })
  );
}

function giteaClient(endpoint: ForgeEndpoint): ForgeClient {
  const apiBase = `${endpoint.url}/api/v1`;
  const headers = (accept: 'json' | 'text'): Record<string, string> => ({
    Authorization: `token ${endpoint.token}`,
    Accept: accept === 'json' ? 'application/json' : 'text/plain'
  });
  const api: ActionsApi = {
    provider: endpoint.provider,
    webUrl: endpoint.url,
    get: (path, accept = 'json') => request(`${apiBase}${path}`, headers(accept), endpoint.provider, accept)
  };
  const repoUrl = (repo: string): string => `${endpoint.url}/${repo}`;
  return {
    async test() {
      const versionJson = asRecord(await api.get('/version'));
      const version = str(versionJson?.version);
      if (!version) throw new ForgeHttpError(0, 'URL does not look like a Gitea or Forgejo server');
      const user = asRecord(await api.get('/user'));
      // Forgejo reports e.g. `11.0.1+gitea-1.22.0`; plain Gitea reports `1.24.3`.
      const provider: ForgeProvider = /\+gitea/i.test(version) ? 'forgejo' : 'gitea';
      return { provider, version, username: str(user?.login) ?? str(user?.username) ?? undefined };
    },
    fetchRuns: (repo, ref) => fetchActionsRuns(api, repo, ref),
    // Forgejo and Gitea < 1.24 have no jobs/logs API; callers fall back to the run link.
    fetchFailedJobLogs: (repo, runId) => fetchActionsFailedJobLogs(api, repo, runId),
    repoUrl,
    runsUrl: (repo, source) => (source === 'actions' ? `${repoUrl(repo)}/actions` : repoUrl(repo)),
    runUrl: (repo, runId) => `${repoUrl(repo)}/actions/runs/${runId}`
  };
}

/** `https://github.com` → public API; anything else is GitHub Enterprise Server. */
export function githubApiBase(webUrl: string): string {
  try {
    const host = new URL(webUrl).hostname.toLowerCase();
    if (host === 'github.com' || host === 'www.github.com') return 'https://api.github.com';
  } catch {
    // fall through to GHES layout
  }
  return `${webUrl}/api/v3`;
}

function githubClient(endpoint: ForgeEndpoint): ForgeClient {
  const apiBase = githubApiBase(endpoint.url);
  const headers = (accept: 'json' | 'text'): Record<string, string> => ({
    Authorization: `Bearer ${endpoint.token}`,
    Accept: accept === 'json' ? 'application/vnd.github+json' : '*/*',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'novacode'
  });
  const api: ActionsApi = {
    provider: 'github',
    webUrl: endpoint.url,
    get: (path, accept = 'json') => request(`${apiBase}${path}`, headers(accept), 'github', accept)
  };
  const repoUrl = (repo: string): string => `${endpoint.url}/${repo}`;
  return {
    async test() {
      const user = asRecord(await api.get('/user'));
      const login = str(user?.login);
      if (!login) throw new ForgeHttpError(0, 'URL does not look like a GitHub server');
      return { provider: 'github', username: login };
    },
    fetchRuns: (repo, ref) => fetchActionsRuns(api, repo, ref),
    fetchFailedJobLogs: (repo, runId) => fetchActionsFailedJobLogs(api, repo, runId),
    repoUrl,
    runsUrl: (repo, source) => (source === 'actions' ? `${repoUrl(repo)}/actions` : `${repoUrl(repo)}/commits`),
    runUrl: (repo, runId) => `${repoUrl(repo)}/actions/runs/${runId}`
  };
}

// -------------------------------------------------- GitLab --------------------------------------------------

function gitlabClient(endpoint: ForgeEndpoint): ForgeClient {
  const apiBase = `${endpoint.url}/api/v4`;
  const get = (path: string, accept: 'json' | 'text' = 'json'): Promise<unknown> =>
    request(
      `${apiBase}${path}`,
      { 'PRIVATE-TOKEN': endpoint.token, Accept: accept === 'json' ? 'application/json' : 'text/plain' },
      'gitlab',
      accept
    );
  const project = (repo: string): string => `/projects/${encodeURIComponent(repo)}`;
  const repoUrl = (repo: string): string => `${endpoint.url}/${repo}`;
  return {
    async test() {
      const versionJson = asRecord(await get('/version'));
      const version = str(versionJson?.version);
      if (!version) throw new ForgeHttpError(0, 'URL does not look like a GitLab server');
      const user = asRecord(await get('/user'));
      return { provider: 'gitlab', version, username: str(user?.username) ?? undefined };
    },
    async fetchRuns(repo, ref) {
      const params = new URLSearchParams({ per_page: String(RUNS_PAGE_SIZE), order_by: 'id', sort: 'desc' });
      if (ref.branch) params.set('ref', ref.branch);
      else if (ref.sha) params.set('sha', ref.sha);
      try {
        const list = await get(`${project(repo)}/pipelines?${params}`);
        const runs = (Array.isArray(list) ? list : [])
          .map(normalizeGitlabPipeline)
          .filter((run): run is CiRun => run !== null);
        return { source: 'actions', runs };
      } catch (err) {
        if (err instanceof ForgeHttpError && err.status === 404) {
          throw new ForgeHttpError(404, `Project ${repo} not found on GitLab (or the token cannot see it)`);
        }
        throw err;
      }
    },
    async fetchFailedJobLogs(repo, runId) {
      const list = await get(`${project(repo)}/pipelines/${runId}/jobs?scope[]=failed&per_page=50`);
      const jobs = (Array.isArray(list) ? list : [])
        .map(asRecord)
        .filter((job): job is Record<string, unknown> => job !== null)
        .slice(0, MAX_FAILED_JOB_LOGS);
      return Promise.all(
        jobs.map(async (job) => {
          const name = str(job.name) ?? `Job ${String(job.id)}`;
          const stage = str(job.stage);
          const failedSteps = stage ? [stage] : [];
          const jobId = num(job.id);
          if (jobId === null) return { name, log: null, failedSteps };
          try {
            const log = (await get(`${project(repo)}/jobs/${jobId}/trace`, 'text')) as string;
            return { name, log: tailLog(cleanJobLog(log)), failedSteps };
          } catch {
            return { name, log: null, failedSteps };
          }
        })
      );
    },
    repoUrl,
    runsUrl: (repo) => `${repoUrl(repo)}/-/pipelines`,
    runUrl: (repo, runId) => `${repoUrl(repo)}/-/pipelines/${runId}`
  };
}

export function forgeClient(endpoint: ForgeEndpoint): ForgeClient {
  switch (endpoint.provider) {
    case 'github':
      return githubClient(endpoint);
    case 'gitlab':
      return gitlabClient(endpoint);
    default:
      return giteaClient(endpoint);
  }
}
