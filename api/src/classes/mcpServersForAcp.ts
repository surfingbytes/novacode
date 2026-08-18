// node_modules
import type { McpServer } from '@agentclientprotocol/sdk';

// classes
import {
  readMcpClients,
  writeAgentMcpAutoloadFiles,
  type McpClientServerConfig
} from './config';
import { checkMcpClients, type McpCheckResult } from './mcpConnectivityCheck';
import { logger } from './logger';

/** Startup/save probe — does not run on the agent prompt path. */
const AUTOLOAD_HTTP_TIMEOUT_MS = 5_000;

export interface SkippedMcpServer {
  name: string;
  error: string;
}

export interface McpAutoloadStatus {
  status: 'pending' | 'ready';
  enabled: string[];
  skipped: SkippedMcpServer[];
  probedAt: number | null;
}

let autoloadStatus: McpAutoloadStatus = {
  status: 'pending',
  enabled: [],
  skipped: [],
  probedAt: null
};

export function getMcpAutoloadStatus(): McpAutoloadStatus {
  return autoloadStatus;
}

function headersToAcp(headers?: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(headers ?? {}).map(([name, value]) => ({ name, value }));
}

function envToAcp(env?: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(env ?? {}).map(([name, value]) => ({ name, value }));
}

/** Convert one Settings MCP entry to an ACP `mcpServers` item, or null if invalid. */
export function toAcpMcpServer(name: string, cfg: McpClientServerConfig): McpServer | null {
  const url = cfg.url?.trim();
  const command = cfg.command?.trim();
  if (url && !command) {
    const headers = headersToAcp(cfg.headers);
    if (cfg.type === 'sse') {
      return { type: 'sse', name, url, headers };
    }
    return { type: 'http', name, url, headers };
  }
  if (command) {
    return {
      name,
      command,
      args: cfg.args ?? [],
      env: envToAcp(cfg.env)
    };
  }
  return null;
}

/** Split configured servers into reachable (for autoload) vs skipped. */
export function partitionMcpClients(
  clients: Record<string, McpClientServerConfig>,
  checks: Record<string, McpCheckResult>
): { enabled: Record<string, McpClientServerConfig>; skipped: SkippedMcpServer[] } {
  const enabled: Record<string, McpClientServerConfig> = {};
  const skipped: SkippedMcpServer[] = [];

  for (const [name, cfg] of Object.entries(clients)) {
    const check = checks[name];
    if (!check?.ok) {
      skipped.push({
        name,
        error: check?.error?.trim() || 'Unreachable'
      });
      continue;
    }
    enabled[name] = cfg;
  }

  return { enabled, skipped };
}

/** Write only reachable servers into Cursor/Claude autoload files and record status. */
export function applyMcpAutoloadFromChecks(
  configDir: string,
  clients: Record<string, McpClientServerConfig>,
  checks: Record<string, McpCheckResult>
): McpAutoloadStatus {
  const { enabled, skipped } = partitionMcpClients(clients, checks);
  writeAgentMcpAutoloadFiles(configDir, enabled);
  autoloadStatus = {
    status: 'ready',
    enabled: Object.keys(enabled),
    skipped,
    probedAt: Date.now()
  };
  if (skipped.length > 0) {
    logger.warn(
      { skipped },
      'Ignoring unreachable MCP servers so they cannot crash the agent'
    );
  }
  return autoloadStatus;
}

/**
 * Probe configured MCP after the API is up. Reachable servers are restored to
 * agent autoload files (same as before); the rest are skipped with a warning.
 * Never throws.
 */
export async function applyReachableMcpAutoload(configDir: string): Promise<McpAutoloadStatus> {
  autoloadStatus = {
    status: 'pending',
    enabled: [],
    skipped: [],
    probedAt: null
  };
  try {
    const clients = readMcpClients(configDir);
    if (Object.keys(clients).length === 0) {
      writeAgentMcpAutoloadFiles(configDir, {});
      autoloadStatus = { status: 'ready', enabled: [], skipped: [], probedAt: Date.now() };
      return autoloadStatus;
    }
    const checks = await checkMcpClients(configDir, clients, {
      httpTimeoutMs: AUTOLOAD_HTTP_TIMEOUT_MS
    });
    return applyMcpAutoloadFromChecks(configDir, clients, checks);
  } catch (err) {
    logger.warn({ err }, 'MCP connectivity check failed; continuing without MCP');
    try {
      writeAgentMcpAutoloadFiles(configDir, {});
    } catch {
      // autoload files are best-effort
    }
    autoloadStatus = {
      status: 'ready',
      enabled: [],
      skipped: [{ name: 'mcp', error: String(err) }],
      probedAt: Date.now()
    };
    return autoloadStatus;
  }
}

export function mcpUnavailableNoticeText(skipped: SkippedMcpServer[]): string {
  if (skipped.length === 0) {
    return '';
  }
  const names = skipped.map((s) => s.name).join(', ');
  const noun = skipped.length === 1 ? 'MCP server' : 'MCP servers';
  return `${noun} ${names} ${skipped.length === 1 ? 'is' : 'are'} not reachable and ${
    skipped.length === 1 ? 'was' : 'were'
  } skipped so the session could start. Tools from ${
    skipped.length === 1 ? 'that server' : 'those servers'
  } are unavailable until ${skipped.length === 1 ? 'it is' : 'they are'} running.`;
}

/** Serialized stream event (persisted, rendered as a chat notice). */
export function mcpUnavailableNoticeEventLine(skipped: SkippedMcpServer[]): string | null {
  const text = mcpUnavailableNoticeText(skipped);
  if (!text) {
    return null;
  }
  return JSON.stringify({ type: 'mcp_unavailable_notice', text });
}
