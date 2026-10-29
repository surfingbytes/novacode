// classes
import { getAgentAdapter } from './agents';
import { toModelOption } from './agents/modelOptions';

// types
import type { AgentType } from '../@types/index';
import type { AgentModelOption } from './agents';

export type { AgentModelOption } from './agents';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

const cache = new Map<AgentType, { models: AgentModelOption[]; fetchedAt: number }>();

export async function getAgentModels(
  agentType: AgentType
): Promise<{ models: AgentModelOption[]; fromCache: boolean }> {
  const now = Date.now();
  const cached = cache.get(agentType);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { models: cached.models, fromCache: true };
  }

  const rawModels = (await getAgentAdapter(agentType).probeModels()).models;

  const withAuto = rawModels.some((model) => model.id === 'auto')
    ? rawModels
    : [{ id: 'auto', label: 'Auto' }, ...rawModels];
  const models = (withAuto.length > 0 ? withAuto : [{ id: 'auto', label: 'Auto' }]).map(toModelOption);
  cache.set(agentType, { models, fetchedAt: now });
  return { models, fromCache: false };
}
