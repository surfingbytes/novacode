// node_modules
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

import { resolveDatabaseUrl } from '../env';
import { sshEnvForGit } from './sshKey';
import { DEFAULT_WORKSPACE_BROWSE_ROOT } from '@novacode/shared';

// --------------------------------------------- Config ---------------------------------------------

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

/** Server-only secrets. `scrubServerSecretsFromEnv` moves them out of `process.env` at boot. */
export const SERVER_SECRET_ENV_KEYS = [
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'POSTGRES_PASSWORD',
  'DATABASE_URL',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY'
] as const;

type ServerSecretKey = (typeof SERVER_SECRET_ENV_KEYS)[number];

const capturedSecrets: Partial<Record<ServerSecretKey, string>> = {};

/** Live env value wins (tests set it late); after the boot scrub the captured copy is used. */
function serverSecret(name: ServerSecretKey): string {
  return process.env[name] ?? capturedSecrets[name] ?? '';
}

/**
 * Copies server secrets into `config` and deletes them from `process.env`, so nothing
 * that inherits the process env (in-process Claude agent, its CLI) can read them.
 * DATABASE_URL is captured fully resolved, since POSTGRES_PASSWORD is removed too.
 */
export function scrubServerSecretsFromEnv(): void {
  try {
    capturedSecrets['DATABASE_URL'] = resolveDatabaseUrl();
  } catch {
    // no DB settings: db/client reports it when the pool is created
  }
  for (const key of SERVER_SECRET_ENV_KEYS) {
    const value = process.env[key];
    if (value === undefined) continue;
    if (key !== 'DATABASE_URL') capturedSecrets[key] = value;
    delete process.env[key];
  }
}

const EXAMPLE_JWT_SECRET = 'change_this_to_a_long_random_string';

export { DEFAULT_WORKSPACE_BROWSE_ROOT };

const MIN_JWT_SECRET_LENGTH = 32;
export const ENCRYPTION_KEY_BYTES = 32;
const DEFAULT_PORT = 3000;

/** Fail process startup when JWT_SECRET is missing, too short or still the example placeholder. */
function assertJwtSecret(): void {
  const secret = config.jwtSecret.trim();
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  if (secret === EXAMPLE_JWT_SECRET) {
    throw new Error('JWT_SECRET must be a unique secret, not the example placeholder');
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters (got ${secret.length}); generate one with \`openssl rand -hex 32\``
    );
  }
}

/** Integer port 1–65535, or null when `raw` is anything else. */
export function parsePort(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const port = Number(trimmed);
  return port >= 1 && port <= 65535 ? port : null;
}

/** ENCRYPTION_KEY as 32 raw bytes (hex or base64 encoded), or null when it decodes to another length. */
export function decodeEncryptionKey(value: string): Buffer | null {
  const hex = Buffer.from(value, 'hex');
  if (hex.length === ENCRYPTION_KEY_BYTES) return hex;
  const b64 = Buffer.from(value, 'base64');
  if (b64.length === ENCRYPTION_KEY_BYTES) return b64;
  return null;
}

/**
 * Validate boot config; throws one clear message on the first problem.
 * ENCRYPTION_KEY stays optional (install files don't provision it and the key is
 * then derived from JWT_SECRET); when set it must decode to 32 bytes.
 */
export function assertBootConfig(): void {
  assertJwtSecret();
  const rawPort = process.env['PORT'];
  if (rawPort !== undefined && parsePort(rawPort) === null) {
    throw new Error(`PORT must be an integer between 1 and 65535 (got "${rawPort}")`);
  }
  const encryptionKey = config.encryptionKey;
  if (encryptionKey && !decodeEncryptionKey(encryptionKey)) {
    throw new Error(`ENCRYPTION_KEY must be ${ENCRYPTION_KEY_BYTES} bytes, hex or base64 encoded`);
  }
}

export const config = {
  // auth: credentials stored in DB, first-use setup creates the initial user
  get jwtSecret(): string {
    return serverSecret('JWT_SECRET');
  },
  get encryptionKey(): string {
    return serverSecret('ENCRYPTION_KEY');
  },
  /** Postgres connection string, handed to the pg Pool directly (not via process.env). */
  get databaseUrl(): string {
    return process.env['DATABASE_URL']?.trim() || capturedSecrets['DATABASE_URL'] || resolveDatabaseUrl();
  },
  /** Validated at boot by `assertBootConfig`. */
  get port(): number {
    return parsePort(optional('PORT', String(DEFAULT_PORT))) ?? DEFAULT_PORT;
  },
  /** Cursor CLI. Resolved lazily so local/dev PATH installs and Docker installs both work. */
  get cursorCommand(): string {
    const override = process.env['CURSOR_COMMAND'];
    if (override) return override;
    if (existsSync('/root/.local/bin/cursor-agent')) return '/root/.local/bin/cursor-agent';
    if (existsSync('/root/.local/bin/agent')) return '/root/.local/bin/agent';
    return 'cursor-agent';
  },
  /** Backwards-compatible alias for older Cursor ACP wiring. Prefer `cursorCommand`. */
  get cursorAcpCommand(): string {
    return config.cursorCommand;
  },
  claudeCommand: 'claude',
  openCodeCommand: 'opencode',
  codexCommand: 'codex',
  /** Mistral Vibe CLI (interactive). Resolved lazily so fresh installs are picked up. */
  get vibeCommand(): string {
    const override = process.env['VIBE_COMMAND'];
    if (override) return override;
    return existsSync('/root/.local/bin/vibe') ? '/root/.local/bin/vibe' : 'vibe';
  },
  /** Mistral Vibe ACP server entrypoint. Spawned per prompt turn for ACP communication. */
  get vibeAcpCommand(): string {
    const override = process.env['VIBE_ACP_COMMAND'];
    if (override) return override;
    return existsSync('/root/.local/bin/vibe-acp') ? '/root/.local/bin/vibe-acp' : 'vibe-acp';
  },
  /** OpenCode ACP server entrypoint. Spawned per prompt turn for ACP communication. */
  get openCodeAcpCommand(): string {
    const override = process.env['OPENCODE_ACP_COMMAND'];
    if (override) return override;
    return config.openCodeCommand;
  },
  /** Codex ACP server entrypoint. */
  get codexAcpCommand(): string {
    const override = process.env['CODEX_ACP_COMMAND'];
    if (override) return override;
    return existsSync('/root/.local/bin/codex-acp') ? '/root/.local/bin/codex-acp' : 'codex-acp';
  },
  /** Override with CONFIG_DIR (e.g. the e2e harness points it at a temp dir). */
  configDir: optional('CONFIG_DIR', '/config') || '/config',
  /**
   * Body limit for the attachment-upload route, in MiB (env UPLOAD_BODY_LIMIT_MB).
   * Uploads are base64-in-JSON, so the body is ~4/3× the file size — the default
   * 512 MiB body allows roughly 380 MiB video files. Other routes keep the
   * smaller global limit (BODY_LIMIT_BYTES in index.ts).
   */
  get uploadBodyLimitBytes(): number {
    const mb = parseInt(optional('UPLOAD_BODY_LIMIT_MB', '512'), 10);
    return (Number.isFinite(mb) && mb > 0 ? mb : 512) * 1024 * 1024;
  },
  /**
   * Root directory for workspaces inside the container. Paths in the DB are
   * relative to this. Override with WORKSPACE_BROWSE_ROOT.
   */
  workspaceBrowseRoot:
    optional('WORKSPACE_BROWSE_ROOT', DEFAULT_WORKSPACE_BROWSE_ROOT) || DEFAULT_WORKSPACE_BROWSE_ROOT,

  // env vars forwarded to spawned agent processes
  agentEnv: (gitOverrides?: { name?: string; email?: string }) => {
    const configDir = config.configDir;
    const env: Record<string, string> = {};
    const forward = [
      'PATH',
      'TERM',
      'LANG',
      'LC_ALL',
      'USER',
      'LOGNAME',
      'XDG_CONFIG_HOME',
      'XDG_DATA_HOME',
      'CURSOR_HOME',
      'VIBE_HOME'
    ];
    for (const key of forward) {
      if (process.env[key]) {
        env[key] = process.env[key]!;
      }
    }
    // OpenCode home directory
    if (process.env['OPENCODE_HOME']) {
      env['OPENCODE_HOME'] = process.env['OPENCODE_HOME'];
    }
    for (const [k, v] of Object.entries(process.env)) {
      if (k.startsWith('AGENT_ENV_') && v) {
        env[k.slice('AGENT_ENV_'.length)] = v;
      }
    }
    env['TERM'] = env['TERM'] || 'xterm-256color';

    // ensure user-local bin dirs are always on PATH so tools installed post-startup (e.g. vibe) are found
    const localBins = ['/root/.local/bin', '/root/.opencode/bin', '/usr/local/bin'];
    const currentPath = env['PATH'] || '';
    const pathParts = currentPath.split(':').filter(Boolean);
    for (const bin of localBins) {
      if (!pathParts.includes(bin)) {
        pathParts.unshift(bin);
      }
    }
    env['PATH'] = pathParts.join(':');

    // home directories
    env['HOME'] = configDir;
    env['CURSOR_HOME'] = configDir;
    env['VIBE_HOME'] = configDir + '/.vibe';
    env['CLAUDE_CONFIG_DIR'] = configDir;
    env['OPENCODE_HOME'] = env['OPENCODE_HOME'] || configDir + '/.opencode';
    env['CODEX_HOME'] = env['CODEX_HOME'] || configDir + '/.codex';
    env['XDG_CONFIG_HOME'] = env['XDG_CONFIG_HOME'] || configDir + '/.config';
    env['XDG_DATA_HOME'] = env['XDG_DATA_HOME'] || configDir + '/.local/share';

    // workspace-level git identity overrides take precedence over .gitconfig user section
    if (gitOverrides?.name) {
      env['GIT_AUTHOR_NAME'] = gitOverrides.name;
      env['GIT_COMMITTER_NAME'] = gitOverrides.name;
    }
    if (gitOverrides?.email) {
      env['GIT_AUTHOR_EMAIL'] = gitOverrides.email;
      env['GIT_COMMITTER_EMAIL'] = gitOverrides.email;
    }
    Object.assign(env, sshEnvForGit(configDir));
    return env;
  }
};

// --------------------------------------------- Functions ---------------------------------------------

// write (or update) configDir/.gitconfig with safe.directory = * and optional global user identity.
// Preserves other sections (e.g. includeIf) so custom git config survives restarts.
export function writeGlobalGitConfig(
  configDir: string,
  name: string | null,
  email: string | null
): void {
  const filePath = join(configDir, '.gitconfig');
  let existing = '';
  if (existsSync(filePath)) {
    try {
      existing = readFileSync(filePath, 'utf8');
    } catch {
      existing = '';
    }
  }

  const lines = existing.split(/\r?\n/);
  const out: string[] = [];
  let section: string | null = null;
  let sawSafe = false;
  let sawUser = false;
  let wroteSafeDirectory = false;
  let wroteUserName = false;
  let wroteUserEmail = false;

  const flushUserTrailing = (): void => {
    if (section !== 'user') return;
    if (name && !wroteUserName) out.push(`\tname = ${name}`);
    if (email && !wroteUserEmail) out.push(`\temail = ${email}`);
  };

  for (const line of lines) {
    const sectionMatch = line.match(/^\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      flushUserTrailing();
      section = sectionMatch[1]!.trim().toLowerCase();
      if (section === 'safe') sawSafe = true;
      if (section === 'user') sawUser = true;
      out.push(line);
      continue;
    }

    if (section === 'safe') {
      if (/^\s*directory\s*=/.test(line)) {
        if (!wroteSafeDirectory) {
          out.push('\tdirectory = *');
          wroteSafeDirectory = true;
        }
        continue;
      }
    }

    if (section === 'user') {
      if (/^\s*name\s*=/.test(line)) {
        if (name) {
          if (!wroteUserName) {
            out.push(`\tname = ${name}`);
            wroteUserName = true;
          }
          continue;
        }
      }
      if (/^\s*email\s*=/.test(line)) {
        if (email) {
          if (!wroteUserEmail) {
            out.push(`\temail = ${email}`);
            wroteUserEmail = true;
          }
          continue;
        }
      }
    }

    // Drop trailing empty lines; we'll normalize at the end
    out.push(line);
  }
  flushUserTrailing();

  if (!sawSafe) {
    out.unshift('[safe]', '\tdirectory = *');
  } else if (!wroteSafeDirectory) {
    // [safe] existed but had no directory — insert after the section header
    const idx = out.findIndex((l) => /^\[safe\]\s*$/i.test(l));
    if (idx >= 0) out.splice(idx + 1, 0, '\tdirectory = *');
  }

  if ((name || email) && !sawUser) {
    out.push('[user]');
    if (name) out.push(`\tname = ${name}`);
    if (email) out.push(`\temail = ${email}`);
  }

  const content =
    out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+/, '')
      .replace(/\n*$/, '\n');
  writeFileSync(filePath, content, 'utf8');
}

const VIBE_ENV_DIR = '.vibe';
const VIBE_ENV_FILE = '.env';
const MISTRAL_API_KEY_VAR = 'MISTRAL_API_KEY';

export function getVibeApiKeyStatus(configDir: string): { configured: boolean } {
  const envPath = join(configDir, VIBE_ENV_DIR, VIBE_ENV_FILE);
  if (!existsSync(envPath)) return { configured: false };
  try {
    const content = readFileSync(envPath, 'utf8');
    const line = content
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith(`${MISTRAL_API_KEY_VAR}=`));
    const value = line?.slice(MISTRAL_API_KEY_VAR.length + 1).trim();
    return { configured: !!value };
  } catch {
    return { configured: false };
  }
}

export function setVibeApiKey(configDir: string, apiKey: string): void {
  const dir = join(configDir, VIBE_ENV_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const envPath = join(dir, VIBE_ENV_FILE);
  const content = `${MISTRAL_API_KEY_VAR}=${apiKey.trim()}\n`;
  writeFileSync(envPath, content, 'utf8');
}

export function clearVibeApiKey(configDir: string): void {
  const envPath = join(configDir, VIBE_ENV_DIR, VIBE_ENV_FILE);
  if (!existsSync(envPath)) {
    return;
  }
  writeFileSync(envPath, '', 'utf8');
}

/**
 * Claude is available via ACP when the @agentclientprotocol/claude-agent-acp package is
 * installed (always true in this build) and a Claude OAuth token has been stored.
 * The token check is done at the call site since it requires DB access.
 */
export function isClaudeAvailable(_configDir: string): boolean {
  try {
    // The ACP package is ESM-only; probe via the wildcard export (./*) which
    // exposes package.json and avoids the CJS-import-of-ESM failure.
    require.resolve('@agentclientprotocol/claude-agent-acp/package.json');
    return true;
  } catch {
    return false;
  }
}

/**
 * CLI `--version` probes take seconds. Cache results so hot paths like
 * GET /settings/agent-capabilities stay fast on every dashboard open.
 */
const CLI_PROBE_TTL_MS = 60_000;
type CliProbeCache = { ok: boolean; at: number };
let vibeCliCache: CliProbeCache | null = null;
let codexCliCache: CliProbeCache | null = null;

function readCliCache(cache: CliProbeCache | null): boolean | undefined {
  if (cache && Date.now() - cache.at < CLI_PROBE_TTL_MS) {
    return cache.ok;
  }
  return undefined;
}

async function probeCliVersion(command: string, configDir: string): Promise<boolean> {
  // Absolute paths: skip the spawn when the binary is clearly missing.
  if (command.startsWith('/') && !existsSync(command)) {
    return false;
  }
  return new Promise((resolve) => {
    execFile(
      command,
      ['--version'],
      { encoding: 'utf8', timeout: 5000, cwd: configDir, env: config.agentEnv() },
      (err) => resolve(!err)
    );
  });
}

/** True when the vibe-acp ACP server binary is on PATH and exits cleanly for --version. */
export async function isVibeCliAvailable(configDir: string): Promise<boolean> {
  const cached = readCliCache(vibeCliCache);
  if (cached !== undefined) {
    return cached;
  }
  const ok = await probeCliVersion(config.vibeAcpCommand, configDir);
  vibeCliCache = { ok, at: Date.now() };
  return ok;
}

// ── Agent runtime settings (editable from the dashboard) ────────────────────

export interface AgentRuntimeSettings {
  /** Idle timeout (ms) for a prompt that produces no output before the run is stopped; 0 disables. */
  promptIdleTimeoutMs?: number;
  /** How long (ms) an embedded Claude agent (CLI + MCP children) may sit unused before it is disposed; 0 disables. */
  claudeAgentIdleTimeoutMs?: number;
}

/** Default idle timeout for an agent prompt that produces no output (5 minutes). */
export const DEFAULT_PROMPT_IDLE_TIMEOUT_MS = 300_000;

/** Default idle time before an unused embedded Claude agent is disposed (15 minutes). */
const DEFAULT_CLAUDE_AGENT_IDLE_TIMEOUT_MS = 900_000;

function nonNegativeMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

const AGENT_RUNTIME_FILE = 'agent-runtime.json';

export function readAgentRuntimeSettings(configDir: string): AgentRuntimeSettings {
  const filePath = join(configDir, AGENT_RUNTIME_FILE);
  if (!existsSync(filePath)) return {};
  try {
    const raw = readFileSync(filePath, 'utf8');
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const record = data as Record<string, unknown>;
    const settings: AgentRuntimeSettings = {};
    const promptIdleTimeoutMs = nonNegativeMs(record.promptIdleTimeoutMs);
    if (promptIdleTimeoutMs !== undefined) settings.promptIdleTimeoutMs = promptIdleTimeoutMs;
    const claudeAgentIdleTimeoutMs = nonNegativeMs(record.claudeAgentIdleTimeoutMs);
    if (claudeAgentIdleTimeoutMs !== undefined) settings.claudeAgentIdleTimeoutMs = claudeAgentIdleTimeoutMs;
    return settings;
  } catch {
    return {};
  }
}

export function writeAgentRuntimeSettings(configDir: string, settings: AgentRuntimeSettings): void {
  writeFileSync(join(configDir, AGENT_RUNTIME_FILE), JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

/** Effective prompt idle timeout: ACP_PROMPT_IDLE_TIMEOUT_MS env > settings file > default. */
export function resolvePromptIdleTimeoutMs(configDir: string): number {
  const raw = Number.parseInt(process.env['ACP_PROMPT_IDLE_TIMEOUT_MS'] ?? '', 10);
  if (Number.isFinite(raw)) return raw;
  return readAgentRuntimeSettings(configDir).promptIdleTimeoutMs ?? DEFAULT_PROMPT_IDLE_TIMEOUT_MS;
}

/** Effective embedded Claude agent idle timeout: CLAUDE_AGENT_IDLE_TIMEOUT_MS env > settings file > default. */
export function resolveClaudeAgentIdleTimeoutMs(configDir: string): number {
  const raw = Number.parseInt(process.env['CLAUDE_AGENT_IDLE_TIMEOUT_MS'] ?? '', 10);
  if (Number.isFinite(raw)) return raw;
  return readAgentRuntimeSettings(configDir).claudeAgentIdleTimeoutMs ?? DEFAULT_CLAUDE_AGENT_IDLE_TIMEOUT_MS;
}

// ── MCP client configuration (sync to Cursor & Claude) ──────────────────────

export interface McpClientServerConfig {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** When false, kept in mcp-clients.json but not loaded for agents. Default true. */
  enabled?: boolean;
  [key: string]: unknown;
}

/** Missing/undefined `enabled` means on (backward compatible). */
export function isMcpClientEnabled(cfg: McpClientServerConfig): boolean {
  return cfg.enabled !== false;
}

const MCP_CLIENTS_FILE = 'mcp-clients.json';

export function readMcpClients(configDir: string): Record<string, McpClientServerConfig> {
  const filePath = join(configDir, MCP_CLIENTS_FILE);
  if (!existsSync(filePath)) return {};
  try {
    const raw = readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/** Shape MCP entries for agent configs (Claude Code expects type on HTTP servers). */
function normalizeMcpServersForAgents(
  servers: Record<string, McpClientServerConfig>
): Record<string, McpClientServerConfig> {
  const out: Record<string, McpClientServerConfig> = {};
  for (const [name, s] of Object.entries(servers)) {
    const copy: McpClientServerConfig = { ...s };
    // Nova-only flag — do not pass through to Cursor/Claude MCP configs.
    delete copy.enabled;
    if (copy.url && !copy.command && copy.type === undefined) {
      copy.type = 'http';
    }
    out[name] = copy;
  }
  return out;
}

/**
 * Write Cursor/Claude autoload files. Pass `{}` to keep agents from connecting
 * to MCP (used until a probe proves servers are reachable).
 */
export function writeAgentMcpAutoloadFiles(
  configDir: string,
  servers: Record<string, McpClientServerConfig>
): void {
  const normalized = normalizeMcpServersForAgents(servers);
  const payload = JSON.stringify({ mcpServers: normalized }, null, 2) + '\n';
  const cursorDir = join(configDir, '.cursor');
  if (!existsSync(cursorDir)) mkdirSync(cursorDir, { recursive: true });
  writeFileSync(join(cursorDir, 'mcp.json'), payload, 'utf8');
  mergeMcpServersIntoClaudeJson(configDir, normalized);
}

/** Clear autoload so a down MCP cannot crash Cursor/Claude on spawn. */
export function clearAgentMcpAutoloadFiles(configDir: string): void {
  writeAgentMcpAutoloadFiles(configDir, {});
}

/**
 * Persist canonical MCP client config. Autoload files are cleared until a
 * probe writes back only reachable servers.
 */
export function writeMcpClients(
  configDir: string,
  servers: Record<string, McpClientServerConfig>
): void {
  writeFileSync(join(configDir, MCP_CLIENTS_FILE), JSON.stringify(servers, null, 2), 'utf8');
  clearAgentMcpAutoloadFiles(configDir);
}

function mergeMcpServersIntoClaudeJson(
  configDir: string,
  servers: Record<string, McpClientServerConfig>
): void {
  const path = join(configDir, '.claude.json');
  let data: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, 'utf8');
      if (raw.trim()) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          data = parsed as Record<string, unknown>;
        }
      }
    } catch {
      data = {};
    }
  }

  const prevRaw = data.mcpServers;
  const prev: Record<string, unknown> =
    prevRaw && typeof prevRaw === 'object' && !Array.isArray(prevRaw)
      ? (prevRaw as Record<string, unknown>)
      : {};

  const merged: Record<string, unknown> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    const existing = prev[name];
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      merged[name] = { ...(existing as Record<string, unknown>), ...cfg };
    } else {
      merged[name] = cfg;
    }
  }

  data.mcpServers = merged;
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

// ensures /config/.claude.json has hasCompletedOnboarding = true

export async function isCodexAcpAvailable(configDir: string): Promise<boolean> {
  const cached = readCliCache(codexCliCache);
  if (cached !== undefined) {
    return cached;
  }
  const ok = await probeCliVersion(config.codexAcpCommand, configDir);
  codexCliCache = { ok, at: Date.now() };
  return ok;
}
