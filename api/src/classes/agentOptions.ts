// node_modules
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// classes
import { config } from './config';
import { AGENT_TYPES, getAgentAdapter } from './agents';
import { logger } from './logger';
import { createSwrCache, readSwrDiskCache, writeSwrDiskCache } from './swrCache';
import type { SwrEntry } from './swrCache';

// types
import type { AgentType } from '../@types/index';
import type { AgentOptionsProbeResult } from './agents';

export interface AgentOptionsResponse extends AgentOptionsProbeResult {
  fromCache: boolean;
}

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

type CachedAgentOptions = AgentOptionsProbeResult;

const optionCaches = new Map<string, ReturnType<typeof createSwrCache<CachedAgentOptions>>>();

function agentOptionsDiskPath(cacheKey: string): string {
  const safe = cacheKey.replace(/[^a-z0-9._-]+/gi, '_');
  return join(config.configDir, 'cache', 'agent-options', `${safe}.json`);
}

/** Version of an installed package, looked up along `from`'s module paths; works even when the
 *  package's exports map hides package.json. */
function packageVersion(from: NodeJS.Require, name: string): string | null {
  for (const dir of from.resolve.paths(name) ?? []) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, name, 'package.json'), 'utf8')) as { version?: string };
      if (manifest.version) return manifest.version;
    } catch {
      // not installed here, try the next path
    }
  }
  return null;
}

/**
 * Versions of the bundled agent packages whose output the cache holds. Claude's model list comes
 * from the ACP package and the Claude Code CLI it ships, so a bump must not serve the old list.
 */
function agentPackagesVersion(agentType: AgentType): string | null {
  if (agentType !== 'claude') return null;
  const acp = '@agentclientprotocol/claude-agent-acp';
  const sdk = '@anthropic-ai/claude-agent-sdk';
  const acpVersion = packageVersion(require, acp);
  if (!acpVersion) return null;
  let sdkVersion: string | null = null;
  try {
    sdkVersion = packageVersion(createRequire(require.resolve(`${acp}/package.json`)), sdk);
  } catch {
    // SDK version is best-effort
  }
  return `${acp}@${acpVersion} ${sdk}@${sdkVersion ?? 'unknown'}`;
}

function storedVersion(diskPath: string): unknown {
  try {
    return (JSON.parse(readFileSync(diskPath, 'utf8')) as { version?: unknown }).version;
  } catch {
    return undefined;
  }
}

function optionsCache(agentType: AgentType, cacheKey: string) {
  let cached = optionCaches.get(cacheKey);
  if (!cached) {
    const diskPath = agentOptionsDiskPath(cacheKey);
    const version = agentPackagesVersion(agentType);
    cached = createSwrCache<CachedAgentOptions>({
      ttlMs: CACHE_TTL_MS,
      isValid: (options) => options.models.length > 0,
      loadDisk: () => {
        const entry = readSwrDiskCache<CachedAgentOptions>(diskPath);
        if (!entry || version === null) return entry;
        return storedVersion(diskPath) === version ? entry : null;
      },
      saveDisk: (entry) => {
        // Extra `version` field on disk; readSwrDiskCache ignores it.
        const stamped: SwrEntry<CachedAgentOptions> = version === null ? entry : Object.assign({ version }, entry);
        writeSwrDiskCache(diskPath, stamped);
      },
    });
    optionCaches.set(cacheKey, cached);
  }
  return cached;
}

function agentOptionsCacheKey(agentType: AgentType, claudeToken?: string | null): string {
  return agentType === 'claude' ? `${agentType}:${claudeToken ? 'auth' : 'anon'}` : agentType;
}

export async function getAgentOptions(
  agentType: AgentType,
  opts?: { claudeToken?: string | null }
): Promise<AgentOptionsResponse> {
  const cacheKey = agentOptionsCacheKey(agentType, opts?.claudeToken);
  const cached = await optionsCache(agentType, cacheKey).get(() =>
    getAgentAdapter(agentType).probeOptions({ claudeToken: opts?.claudeToken })
  );
  return { ...cached.value, fromCache: cached.fromCache };
}

export function warmupAgentOptions(opts?: { claudeToken?: string | null }): void {
  const claudeToken = opts?.claudeToken ?? process.env['CLAUDE_CODE_OAUTH_TOKEN'] ?? null;
  for (const agentType of AGENT_TYPES) {
    void getAgentOptions(
      agentType,
      agentType === 'claude' ? { claudeToken } : undefined
    ).catch((err) => {
      logger.warn({ err, agentType }, 'Agent options warmup failed');
    });
  }
}

export function resetAgentOptionsCache(): void {
  for (const cached of optionCaches.values()) {
    cached.reset();
  }
  optionCaches.clear();
}
