/**
 * Agent type display metadata — single source.
 * Previously 4 diverging copies (AutomationsView was missing `codex` and
 * silently fell back to "Cursor").
 */

// types
import type { AgentType } from '@/@types/index';

const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  claude: 'Claude',
  'cursor-agent': 'Cursor',
  'mistral-vibe': 'Mistral Vibe',
  'open-code': 'OpenCode',
  codex: 'Codex'
};

const AGENT_TYPE_SHORT_LABELS: Record<AgentType, string> = {
  claude: 'claude',
  'cursor-agent': 'cursor',
  'mistral-vibe': 'vibe',
  'open-code': 'opencode',
  codex: 'codex'
};

/** nc-chip variant class (token-tinted via main.css) */
const AGENT_TYPE_CHIP_CLASSES: Record<AgentType, string> = {
  claude: 'agent-claude',
  'cursor-agent': 'agent-cursor',
  'mistral-vibe': 'agent-vibe',
  'open-code': 'agent-opencode',
  codex: 'agent-codex'
};

/** CSS variable holding the agent identity color (set per theme) */
const AGENT_TYPE_TOKEN_VARS: Record<AgentType, string> = {
  claude: '--agent-claude',
  'cursor-agent': '--agent-cursor',
  'mistral-vibe': '--agent-vibe',
  'open-code': '--agent-opencode',
  codex: '--fg-muted'
};

export function agentTypeLabel(agentType: string): string {
  return AGENT_TYPE_LABELS[agentType as AgentType] ?? agentType;
}

export function agentTypeShortLabel(agentType: string): string {
  return AGENT_TYPE_SHORT_LABELS[agentType as AgentType] ?? agentType;
}

export function agentTypeChipClass(agentType: string): string {
  return AGENT_TYPE_CHIP_CLASSES[agentType as AgentType] ?? '';
}

/**
 * Agent-tinted selected state for segmented agent pickers (design handoff:
 * "agent segmented control, agent-tinted when selected"). Returns inline
 * styles since color-mix against per-agent vars can't be a static class.
 */
export function agentSelectedStyle(agentType: string): Record<string, string> {
  const tokenVar = AGENT_TYPE_TOKEN_VARS[agentType as AgentType] ?? '--accent';
  return {
    background: `color-mix(in oklab, var(${tokenVar}) 16%, transparent)`,
    color: `var(${tokenVar})`,
    borderColor: `color-mix(in oklab, var(${tokenVar}) 35%, transparent)`
  };
}
