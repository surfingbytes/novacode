// node_modules
import { join } from 'node:path';

// classes
import { config } from './config';
import { AGENT_TYPES, getAgentAdapter } from './agents';
import { logger } from './logger';
import { createSwrCache, readSwrDiskCache, writeSwrDiskCache } from './swrCache';

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

function optionsCache(cacheKey: string) {
  let cached = optionCaches.get(cacheKey);
  if (!cached) {
    cached = createSwrCache<CachedAgentOptions>({
      ttlMs: CACHE_TTL_MS,
      isValid: (options) => options.models.length > 0,
      loadDisk: () => readSwrDiskCache<CachedAgentOptions>(agentOptionsDiskPath(cacheKey)),
      saveDisk: (entry) => writeSwrDiskCache(agentOptionsDiskPath(cacheKey), entry),
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
  const cached = await optionsCache(cacheKey).get(() =>
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
