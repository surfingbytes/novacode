/**
 * Agent-specific ACP config options (effort, fast mode, etc.) — separate from mode/model.
 */

// classes
import { getAgentAdapter } from './agents';

// types
import type { AgentType } from '../@types/index';
import type { AgentConfigOption } from './agents';

export type { AgentConfigOption } from './agents';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

const cache = new Map<AgentType, { options: AgentConfigOption[]; fetchedAt: number }>();

export async function getAgentConfigOptions(
  agentType: AgentType
): Promise<{ options: AgentConfigOption[]; fromCache: boolean }> {
  const now = Date.now();
  const cached = cache.get(agentType);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { options: cached.options, fromCache: true };
  }

  const probed = (await getAgentAdapter(agentType).probeConfigOptions()).options;
  cache.set(agentType, { options: probed, fetchedAt: now });
  return { options: probed, fromCache: false };
}
