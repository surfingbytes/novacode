// types
import type { AgentType } from '@/@types/index';

/**
 * Agent-tinted overrides for the `.tag` chip on session/orchestrator cards.
 * The `.tag` base style (primary tint) lives in main.css, so these overrides
 * need `!important`. Labels come from `agentTypeLabel` in `@/utils/agentTypeMeta`.
 */
export const AGENT_TYPE_TAG_COLOR: Record<AgentType, string> = {
  claude: 'bg-orange-500/15! text-orange-400! border-orange-500/20!',
  'cursor-agent': 'bg-violet-500/15! text-violet-400! border-violet-500/20!',
  'mistral-vibe': 'bg-emerald-500/15! text-emerald-400! border-emerald-500/20!',
  'open-code': 'bg-cyan-500/15! text-cyan-400! border-cyan-500/20!',
  codex: 'bg-sky-500/15! text-sky-400! border-sky-500/20!'
};
