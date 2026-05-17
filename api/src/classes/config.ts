// node_modules
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { sshEnvForGit } from './sshKey';

// --------------------------------------------- Config ---------------------------------------------

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const config = {
  // auth: credentials stored in DB, first-use setup creates the initial user
  jwtSecret: optional('JWT_SECRET'),
  port: parseInt(optional('PORT', '3000'), 10),
  cursorCommand: '/root/.local/bin/cursor-agent',
  claudeCommand: 'claude',
  openCodeCommand: 'opencode',
  codexCommand: 'codex',
  /** Cursor ACP server entrypoint. Spawned per prompt turn for ACP communication. */
  get cursorAcpCommand(): string {
    const override = process.env['CURSOR_ACP_COMMAND'];
    if (override) return override;
    return existsSync('/root/.local/bin/cursor-agent-acp') ? '/root/.local/bin/cursor-agent-acp' : 'cursor-agent-acp';
  },
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
  configDir: '/config',
  /** Root directory on the host; workspace paths are relative to this. */
  workspaceBrowseRoot: '/data-root',

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

// write (or overwrite) configDir/.gitconfig with safe.directory = * and optional global user identity
export function writeGlobalGitConfig(
  configDir: string,
  name: string | null,
  email: string | null
): void {
  let content = '[safe]\n\tdirectory = *\n';
  if (name || email) {
    content += '[user]\n';
    if (name) content += `\tname = ${name}\n`;
    if (email) content += `\temail = ${email}\n`;
  }
  writeFileSync(join(configDir, '.gitconfig'), content, 'utf8');
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

/** True when the vibe-acp ACP server binary is on PATH and exits cleanly for --version. */
export function isVibeCliAvailable(configDir: string): boolean {
  try {
    const env = { ...process.env, ...config.agentEnv() };
    const result = spawnSync(config.vibeAcpCommand, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      cwd: configDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/** True when the cursor-agent-acp ACP server binary is on PATH and exits cleanly for --version. */
export function isCursorAcpAvailable(configDir: string): boolean {
  try {
    const env = { ...process.env, ...config.agentEnv() };
    const result = spawnSync(config.cursorAcpCommand, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      cwd: configDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/** True when the open-code-acp ACP server binary is on PATH and exits cleanly for --version. */
export function isOpenCodeAcpAvailable(configDir: string): boolean {
  try {
    const env = { ...process.env, ...config.agentEnv() };
    const result = spawnSync(config.openCodeAcpCommand, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      cwd: configDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

// ── MCP client configuration (sync to Cursor & Claude) ──────────────────────

export interface McpClientServerConfig {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
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
    if (copy.url && !copy.command && copy.type === undefined) {
      copy.type = 'http';
    }
    out[name] = copy;
  }
  return out;
}

/**
 * Persist MCP client servers for all workspaces: canonical JSON plus files agents read.
 * - Cursor: /config/.cursor/mcp.json (CURSOR_HOME is /config)
 * - Claude Code: merge mcpServers into /config/.claude.json (user scope, all projects)
 */
export function writeMcpClients(
  configDir: string,
  servers: Record<string, McpClientServerConfig>
): void {
  writeFileSync(join(configDir, MCP_CLIENTS_FILE), JSON.stringify(servers, null, 2), 'utf8');

  const normalized = normalizeMcpServersForAgents(servers);
  const payload = JSON.stringify({ mcpServers: normalized }, null, 2) + '\n';

  const cursorDir = join(configDir, '.cursor');
  if (!existsSync(cursorDir)) mkdirSync(cursorDir, { recursive: true });
  writeFileSync(join(cursorDir, 'mcp.json'), payload, 'utf8');

  mergeMcpServersIntoClaudeJson(configDir, normalized);
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
export function markClaudeOnboardingComplete(configDir: string): void {
  const path = join(configDir, '.claude.json');
  let data: unknown = {};
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, 'utf8');
      if (raw.trim()) {
        data = JSON.parse(raw);
      }
    } catch {
      data = {};
    }
  }
  if (!data || typeof data !== 'object') {
    data = {};
  }
  const obj = data as Record<string, unknown>;
  if (obj.hasCompletedOnboarding === true) {
    return;
  }
  obj.hasCompletedOnboarding = true;
  writeFileSync(path, JSON.stringify(obj, null, 2), 'utf8');
}


export function isCodexAcpAvailable(configDir: string): boolean {
  try {
    const env = { ...process.env, ...config.agentEnv() };
    const result = spawnSync(config.codexAcpCommand, ['--version'], {
      encoding: 'utf8', timeout: 5000, cwd: configDir, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}
