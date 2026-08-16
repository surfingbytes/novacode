import type { AgentType } from './types.js';

export const ONE_SHOT_AGENT_TYPES: readonly AgentType[] = [
  'cursor-agent',
  'claude',
  'mistral-vibe',
  'open-code',
  'codex'
];

export function isOneShotAgentType(value: string | null | undefined): value is AgentType {
  return !!value && (ONE_SHOT_AGENT_TYPES as readonly string[]).includes(value);
}

/** First configured one-shot agent, otherwise cursor-agent. */
export function resolveOneShotAgentType(...candidates: Array<string | null | undefined>): AgentType {
  for (const candidate of candidates) {
    if (isOneShotAgentType(candidate)) {
      return candidate;
    }
  }
  return 'cursor-agent';
}

const INEXPENSIVE_MODEL_RE = /composer|haiku|mini|flash|fast|lite/i;

/** Prefer a fast/cheap model so short utility prompts do not use chat-tier models. */
export function pickInexpensiveModel(
  models: Array<{ id: string; label?: string; model?: string; fast?: boolean | null }>
): string {
  const fast = models.find((model) => model.fast === true);
  if (fast) {
    return fast.id;
  }
  const cheap = models.find(
    (model) =>
      model.id !== 'auto' &&
      INEXPENSIVE_MODEL_RE.test(`${model.id} ${model.label ?? ''} ${model.model ?? ''}`)
  );
  if (cheap) {
    return cheap.id;
  }
  return models.find((model) => model.id !== 'auto')?.id ?? 'auto';
}
