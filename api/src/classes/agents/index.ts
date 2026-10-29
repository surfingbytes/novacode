// classes
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import { cursorAdapter } from './cursor';
import { mistralVibeAdapter } from './mistralVibe';
import { openCodeAdapter } from './openCode';

// types
import type { AgentType } from '@novacode/shared';
import type { AgentAdapter } from './types';

export type * from './types';

/** Built on first use so import cycles through the probe modules can't see a half-built map. */
let registry: Record<AgentType, AgentAdapter> | null = null;

function adapters(): Record<AgentType, AgentAdapter> {
  registry ??= {
    'cursor-agent': cursorAdapter,
    claude: claudeAdapter,
    'mistral-vibe': mistralVibeAdapter,
    'open-code': openCodeAdapter,
    codex: codexAdapter,
  };
  return registry;
}

export const AGENT_TYPES: readonly AgentType[] = ['cursor-agent', 'claude', 'mistral-vibe', 'open-code', 'codex'];

export function isAgentType(value: unknown): value is AgentType {
  return typeof value === 'string' && (AGENT_TYPES as readonly string[]).includes(value);
}

export function getAgentAdapter(type: AgentType): AgentAdapter {
  if (!isAgentType(type)) throw new Error(`Unknown agent type: ${String(type)}`);
  return adapters()[type];
}
