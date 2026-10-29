// classes
import { getAgentAdapter } from './agents';
import { MODE_SENTINEL } from './agents/sessionOptions';

// types
import type { AgentType } from '../@types/index';
import type { AgentModeOption } from './agents';

export type { AgentModeOption } from './agents';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

const STATIC_AGENT_MODES: Record<AgentType, AgentModeOption[]> = {
  'cursor-agent': [
    { id: 'agent', label: 'Agent', description: 'Full tool access', current: true },
    { id: 'plan', label: 'Plan', description: 'Planning, read-only' },
    { id: 'ask', label: 'Ask', description: 'Q&A, read-only' },
  ],
  claude: [
    { id: MODE_SENTINEL, label: 'Default', description: 'Use agent default mode' },
    { id: 'default', label: 'Manual', description: 'Standard permissions' },
    { id: 'acceptEdits', label: 'Accept Edits', description: 'Auto-accept file edits' },
    { id: 'plan', label: 'Plan', description: 'Planning only' },
  ],
  'mistral-vibe': [
    { id: MODE_SENTINEL, label: 'Default', description: 'Use agent default mode' },
    { id: 'default', label: 'Default', description: 'Ask before tools' },
    { id: 'plan', label: 'Plan', description: 'Read-only planning' },
    { id: 'accept-edits', label: 'Accept Edits', description: 'Auto-accept file edits' },
    { id: 'auto-approve', label: 'Auto Approve', description: 'Auto-approve all tools' },
  ],
  'open-code': [
    { id: MODE_SENTINEL, label: 'Default', description: 'Use agent default mode' },
    { id: 'build', label: 'Build', description: 'Full development access' },
    { id: 'plan', label: 'Plan', description: 'Analysis and planning only' },
  ],
  codex: [
    { id: MODE_SENTINEL, label: 'Default', description: 'Use agent default mode' },
    { id: 'read-only', label: 'Read Only', description: 'No file changes' },
    { id: 'plan', label: 'Plan', description: 'Plan before editing' },
    { id: 'auto', label: 'Auto Edit', description: 'Balanced approvals' },
    { id: 'full-access', label: 'Full Access', description: 'Full tool access' },
  ],
};

const cache = new Map<AgentType, { modes: AgentModeOption[]; fetchedAt: number }>();

export async function getAgentModes(agentType: AgentType): Promise<{ modes: AgentModeOption[]; fromCache: boolean }> {
  const now = Date.now();
  const cached = cache.get(agentType);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { modes: cached.modes, fromCache: true };
  }

  const probed = (await getAgentAdapter(agentType).probeModes()).modes;
  const modes = probed.length > 0 ? probed : (STATIC_AGENT_MODES[agentType] ?? [{ id: MODE_SENTINEL, label: 'Default' }]);
  cache.set(agentType, { modes, fetchedAt: now });
  return { modes, fromCache: false };
}
