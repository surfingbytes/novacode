// node_modules
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// classes
import { buildFixBuildPrompt, isActiveCiRun } from './forgeCi';
import { forgeClient, ForgeHttpError, providerLabel } from './forgeClients';
import { logger } from './logger';

// types
import type {
  CiRun,
  ForgeConnectionStatus,
  ForgeConnectionTestResult,
  ForgeProvider,
  SaveForgeConnectionPayload
} from '@novacode/shared';
import type { CiRunsResult, FailedJobLog } from './forgeCi';
import type { ForgeRef } from './forgeClients';

/**
 * Forge connections (Gitea, Forgejo, GitHub, GitLab — any number in parallel) and how a
 * workspace's git remote maps onto one of them. Provider-specific API calls live in
 * `forgeClients.ts`; run normalization and prompts in `forgeCi.ts`.
 */

const FORGE_FILE = 'forge.json';
const ENV_CONNECTION_ID = 'env';
const ACTIVE_CACHE_TTL_MS = 10_000;
const IDLE_CACHE_TTL_MS = 30_000;
const ERROR_CACHE_TTL_MS = 30_000;
/** Public hosts never served by a self-hosted forge connection. */
const PUBLIC_GIT_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org']);
const FORGE_PROVIDERS: ReadonlySet<string> = new Set(['gitea', 'forgejo', 'github', 'gitlab']);

export { ForgeHttpError };

export interface ForgeConnection {
  id: string;
  name: string;
  provider: ForgeProvider;
  url: string;
  token: string;
  remoteHosts: string[];
  version: string | null;
  source: 'env' | 'file';
}

interface StoredConnection {
  id: string;
  provider: ForgeProvider;
  url: string;
  token: string;
  name?: string;
  remoteHosts?: string[];
  version?: string;
}

// -------------------------------------------------- Normalization --------------------------------------------------

/** Strip trailing slashes and API suffixes users often paste. */
export function normalizeForgeUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  url = url.replace(/\/api\/v[134]$/i, '');
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('URL must start with http:// or https://');
  }
  return url;
}

function isForgeProvider(value: unknown): value is ForgeProvider {
  return typeof value === 'string' && FORGE_PROVIDERS.has(value);
}

function urlHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Accepts `host`, `host:port`, `git@host` or a URL; returns bare lowercase hostnames. */
export function normalizeRemoteHosts(raw: string[] | undefined): string[] {
  const hosts = new Set<string>();
  for (const entry of raw ?? []) {
    let value = entry.trim().toLowerCase();
    if (!value) continue;
    value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^[^@/]+@/, '');
    value = value.split(/[/:]/)[0] ?? '';
    if (/^[a-z0-9.-]+$/.test(value)) hosts.add(value);
  }
  return [...hosts];
}

export function defaultConnectionName(provider: ForgeProvider, url: string): string {
  const host = urlHost(url);
  const label = providerLabel(provider);
  return PUBLIC_GIT_HOSTS.has(host) ? label : `${label} (${host || url})`;
}

// -------------------------------------------------- Store --------------------------------------------------

function forgeFilePath(configDir: string): string {
  return join(configDir, FORGE_FILE);
}

function parseStoredConnection(raw: unknown): StoredConnection | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const url = typeof r.url === 'string' ? r.url.trim() : '';
  const token = typeof r.token === 'string' ? r.token.trim() : '';
  if (!url || !token) return null;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : 'default',
    // Pre-multi-connection files only ever held Gitea/Forgejo.
    provider: isForgeProvider(r.provider) ? r.provider : 'gitea',
    url,
    token,
    ...(typeof r.name === 'string' && r.name.trim() ? { name: r.name.trim() } : {}),
    ...(Array.isArray(r.remoteHosts)
      ? { remoteHosts: normalizeRemoteHosts(r.remoteHosts.filter((h): h is string => typeof h === 'string')) }
      : {}),
    ...(typeof r.version === 'string' ? { version: r.version } : {})
  };
}

/** Reads `{ connections: [...] }`, or the legacy single `{ url, token }` object. */
function readStoredConnections(configDir: string): StoredConnection[] {
  const path = forgeFilePath(configDir);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return [];
    const list = (parsed as { connections?: unknown }).connections;
    if (Array.isArray(list)) {
      return list.map(parseStoredConnection).filter((c): c is StoredConnection => c !== null);
    }
    const legacy = parseStoredConnection(parsed);
    return legacy ? [legacy] : [];
  } catch {
    return [];
  }
}

function writeStoredConnections(configDir: string, connections: StoredConnection[]): void {
  writeFileSync(forgeFilePath(configDir), `${JSON.stringify({ connections }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  clearForgeCaches();
}

/** Provider/version learned from connection tests (env connections are never written to disk). */
const detected = new Map<string, { provider: ForgeProvider; version: string | null }>();

function envConnection(): ForgeConnection | null {
  const envUrl = (process.env['FORGE_URL'] ?? '').trim();
  const envToken = (process.env['FORGE_TOKEN'] ?? '').trim();
  if (!envUrl || !envToken) return null;
  let url: string;
  try {
    url = normalizeForgeUrl(envUrl);
  } catch {
    logger.warn({ url: envUrl }, 'Ignoring invalid FORGE_URL');
    return null;
  }
  const envProvider = (process.env['FORGE_PROVIDER'] ?? '').trim().toLowerCase();
  const learned = detected.get(ENV_CONNECTION_ID);
  const provider = learned?.provider ?? (isForgeProvider(envProvider) ? envProvider : 'gitea');
  return {
    id: ENV_CONNECTION_ID,
    name: (process.env['FORGE_NAME'] ?? '').trim() || defaultConnectionName(provider, url),
    provider,
    url,
    token: envToken,
    remoteHosts: normalizeRemoteHosts((process.env['FORGE_REMOTE_HOSTS'] ?? '').split(',')),
    version: learned?.version ?? null,
    source: 'env'
  };
}

/** File connections, plus one from `FORGE_URL` + `FORGE_TOKEN` (+ `FORGE_PROVIDER`) when set. */
export function listForgeConnections(configDir: string): ForgeConnection[] {
  const fromFile: ForgeConnection[] = readStoredConnections(configDir).map((c) => ({
    id: c.id,
    name: c.name ?? defaultConnectionName(c.provider, c.url),
    provider: c.provider,
    url: c.url,
    token: c.token,
    remoteHosts: c.remoteHosts ?? [],
    version: c.version ?? null,
    source: 'file'
  }));
  const env = envConnection();
  return env ? [...fromFile, env] : fromFile;
}

export function getForgeConnection(configDir: string, id: string): ForgeConnection | null {
  return listForgeConnections(configDir).find((c) => c.id === id) ?? null;
}

export function toConnectionStatus(connection: ForgeConnection): ForgeConnectionStatus {
  const { token: _token, ...rest } = connection;
  return rest;
}

/** `gitea` and `forgejo` both mean "Gitea-compatible"; the test result decides which. */
export function createForgeConnection(
  configDir: string,
  input: SaveForgeConnectionPayload,
  test: ForgeConnectionTestResult
): ForgeConnection {
  const url = normalizeForgeUrl(input.url);
  const token = input.token?.trim();
  if (!token) throw new Error('Access token is required');
  const provider = test.provider ?? input.provider;
  const stored: StoredConnection = {
    id: randomUUID().slice(0, 8),
    provider,
    url,
    token,
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    remoteHosts: normalizeRemoteHosts(input.remoteHosts),
    ...(test.version ? { version: test.version } : {})
  };
  writeStoredConnections(configDir, [...readStoredConnections(configDir), stored]);
  return getForgeConnection(configDir, stored.id) as ForgeConnection;
}

export function updateForgeConnection(
  configDir: string,
  id: string,
  input: SaveForgeConnectionPayload,
  test: ForgeConnectionTestResult
): ForgeConnection | null {
  const list = readStoredConnections(configDir);
  const index = list.findIndex((c) => c.id === id);
  if (index < 0) return null;
  const existing = list[index];
  const name = input.name?.trim();
  list[index] = {
    id,
    provider: test.provider ?? input.provider,
    url: normalizeForgeUrl(input.url),
    token: input.token?.trim() || existing.token,
    ...(name ? { name } : {}),
    remoteHosts: input.remoteHosts !== undefined ? normalizeRemoteHosts(input.remoteHosts) : (existing.remoteHosts ?? []),
    ...(test.version ? { version: test.version } : {})
  };
  writeStoredConnections(configDir, list);
  return getForgeConnection(configDir, id);
}

export function deleteForgeConnection(configDir: string, id: string): boolean {
  const list = readStoredConnections(configDir);
  const next = list.filter((c) => c.id !== id);
  if (next.length === list.length) return false;
  writeStoredConnections(configDir, next);
  return true;
}

/** Token for a test: the typed one, else the stored one of `connectionId`. */
export function resolveTestToken(configDir: string, token: string | undefined, connectionId?: string): string {
  if (token?.trim()) return token.trim();
  return connectionId ? (getForgeConnection(configDir, connectionId)?.token ?? '') : '';
}

export async function testForgeConnection(
  input: { provider: ForgeProvider; url: string; token: string },
  connectionId?: string
): Promise<ForgeConnectionTestResult> {
  let url: string;
  try {
    url = normalizeForgeUrl(input.url);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (!input.token.trim()) return { ok: false, error: 'Access token is required' };
  try {
    const result = await forgeClient({ provider: input.provider, url, token: input.token.trim() }).test();
    if (connectionId) detected.set(connectionId, { provider: result.provider, version: result.version ?? null });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Connection test failed' };
  }
}

// -------------------------------------------------- Remote → connection --------------------------------------------------

/** Parses scp-style (`git@host:owner/repo.git`) and URL remotes into host + repo path. */
export function parseGitRemote(remote: string): { host: string; path: string } | null {
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
  const clean = path
    .replace(/\.git\/?$/, '')
    .split('/')
    .filter(Boolean)
    .join('/');
  if (!clean.includes('/')) return null;
  return { host: host.toLowerCase(), path: clean };
}

/**
 * Repo path as the provider addresses it. GitLab keeps nested groups (`group/sub/project`);
 * the others use `owner/name` — the last two segments, so sub-path installs still work.
 */
export function repoPathForProvider(provider: ForgeProvider, path: string, connectionUrl?: string): string | null {
  let segments = path.split('/').filter(Boolean);
  if (provider === 'gitlab') {
    // Drop an install sub-path (`https://host/gitlab/group/project` → `group/project`).
    let prefix: string[] = [];
    try {
      prefix = connectionUrl ? new URL(connectionUrl).pathname.split('/').filter(Boolean) : [];
    } catch {
      prefix = [];
    }
    if (prefix.length && prefix.every((p, i) => segments[i] === p)) segments = segments.slice(prefix.length);
    return segments.length >= 2 ? segments.join('/') : null;
  }
  return segments.length >= 2 ? segments.slice(-2).join('/') : null;
}

/**
 * Picks the connection for a remote: exact host match (web URL or configured remote
 * hosts) first. Self-hosted setups often clone via a different name than the API URL
 * (SSH domain vs internal Docker host), so a non-public remote falls back to the only
 * self-hosted connection when there is exactly one.
 */
export function matchConnectionForRemote(
  remote: string,
  connections: ForgeConnection[]
): { connection: ForgeConnection; repo: string } | null {
  const parsed = parseGitRemote(remote);
  if (!parsed) return null;
  let connection =
    connections.find((c) => urlHost(c.url) === parsed.host || c.remoteHosts.includes(parsed.host)) ?? null;
  if (!connection && !PUBLIC_GIT_HOSTS.has(parsed.host)) {
    const selfHosted = connections.filter((c) => !PUBLIC_GIT_HOSTS.has(urlHost(c.url)));
    if (selfHosted.length === 1) connection = selfHosted[0];
  }
  if (!connection) return null;
  const repo = repoPathForProvider(connection.provider, parsed.path, connection.url);
  return repo ? { connection, repo } : null;
}

export interface ResolvedForgeRepo {
  connection: ForgeConnection;
  repo: string;
  source: 'override' | 'remote';
}

/**
 * Applies the workspace override (connection and/or repo) on top of remote detection.
 * `overrideApplies` is false for nested repos, which always use their own remote.
 */
export function resolveForgeRepo(input: {
  connections: ForgeConnection[];
  remoteUrl: string | null;
  overrideApplies: boolean;
  forgeConnectionId: string | null;
  forgeRepo: string | null;
}): ResolvedForgeRepo | null {
  const { connections, remoteUrl } = input;
  const matched = remoteUrl ? matchConnectionForRemote(remoteUrl, connections) : null;
  if (input.overrideApplies && (input.forgeConnectionId || input.forgeRepo)) {
    const pinned = input.forgeConnectionId ? connections.find((c) => c.id === input.forgeConnectionId) : null;
    const connection = pinned ?? matched?.connection ?? (connections.length === 1 ? connections[0] : null);
    if (connection) {
      const parsed = remoteUrl ? parseGitRemote(remoteUrl) : null;
      const repo =
        input.forgeRepo ??
        (matched?.connection.id === connection.id ? matched.repo : null) ??
        (parsed ? repoPathForProvider(connection.provider, parsed.path, connection.url) : null);
      if (repo) return { connection, repo, source: 'override' };
    }
  }
  return matched ? { ...matched, source: 'remote' } : null;
}

const REPO_PATH_RE = /^[\w.-]+(?:\/[\w.-]+)+$/;

/** Accepts a repo path or a pasted repo/clone URL. Returns null for blank input. */
export function normalizeForgeRepoInput(
  raw: string | null | undefined,
  provider: ForgeProvider | null = null
): string | null {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  if (!value) return null;
  if (REPO_PATH_RE.test(value)) {
    const path = value.replace(/\.git$/, '');
    return provider && provider !== 'gitlab' ? (repoPathForProvider(provider, path) ?? path) : path;
  }
  const parsed = parseGitRemote(value);
  if (parsed) {
    const repo = repoPathForProvider(provider ?? 'github', parsed.path);
    if (repo && REPO_PATH_RE.test(repo)) return repo;
  }
  throw new Error('Forge repository must look like owner/name');
}

// -------------------------------------------------- Cached runs --------------------------------------------------

interface CacheEntry {
  at: number;
  ttl: number;
  promise: Promise<CiRunsResult>;
}

const runsCache = new Map<string, CacheEntry>();

export function clearForgeCaches(): void {
  runsCache.clear();
}

/** Deduplicates concurrent polls (Git tab, header badge, watcher) for the same repo + ref. */
export async function getCachedCiRuns(
  connection: ForgeConnection,
  repo: string,
  ref: ForgeRef,
  opts?: { maxAgeMs?: number }
): Promise<CiRunsResult> {
  const key = [connection.id, connection.url, repo, ref.branch ?? '', ref.branch ? '' : (ref.sha ?? '')].join('|');
  const now = Date.now();
  const cached = runsCache.get(key);
  const maxAge = opts?.maxAgeMs;
  if (cached && now - cached.at < (maxAge !== undefined ? Math.min(maxAge, cached.ttl) : cached.ttl)) {
    return cached.promise;
  }
  const entry: CacheEntry = {
    at: now,
    ttl: IDLE_CACHE_TTL_MS,
    promise: forgeClient(connection).fetchRuns(repo, ref)
  };
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

export function forgeLinks(
  connection: ForgeConnection,
  repo: string,
  source: CiRunsResult['source'] | null
): { repoUrl: string; runsUrl: string } {
  const client = forgeClient(connection);
  return { repoUrl: client.repoUrl(repo), runsUrl: client.runsUrl(repo, source ?? 'actions') };
}

// -------------------------------------------------- Fix-build prompt --------------------------------------------------

export async function buildFixPromptForRun(
  connection: ForgeConnection,
  repo: string,
  branch: string | null,
  run: CiRun | null,
  source: CiRunsResult['source'],
  runId: number
): Promise<{ prompt: string; includesLogs: boolean }> {
  const client = forgeClient(connection);
  let jobs: FailedJobLog[] = [];
  if (source === 'actions') {
    try {
      jobs = await client.fetchFailedJobLogs(repo, runId);
    } catch (err) {
      // Forgejo and older Gitea have no jobs/logs API — the prompt links to the run instead.
      logger.debug({ err, repo, runId }, 'Forge job logs unavailable');
    }
  }
  const runUrl = run?.url ?? (source === 'actions' ? client.runUrl(repo, runId) : null);
  return {
    prompt: buildFixBuildPrompt({ repo, branch, run, runUrl, jobs }),
    includesLogs: jobs.some((job) => job.log)
  };
}
