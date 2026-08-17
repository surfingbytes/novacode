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

type InexpensiveModelOption = {
  id: string;
  label?: string;
  model?: string;
  fast?: boolean | null;
};

function modelBlob(model: InexpensiveModelOption): string {
  return `${model.id} ${model.label ?? ''} ${model.model ?? ''}`;
}

function isFastVariant(model: InexpensiveModelOption): boolean {
  return model.fast === true || /(?:^|[-_/])fast(?:$|[-_/])/i.test(model.id);
}

/**
 * Rank included/cheap families only. Cursor lists paid `*-fast` / `*-mini` / `*-flash`
 * models first (gpt, claude, gemini, grok), so a generic "fast|mini|flash" match
 * would bill extra usage instead of Composer/Auto.
 *
 * Lower is better. `Infinity` means skip.
 */
function inexpensiveRank(model: InexpensiveModelOption): number {
  const id = model.id.trim();
  if (!id) {
    return Number.POSITIVE_INFINITY;
  }
  if (id.toLowerCase() === 'auto') {
    return 40;
  }
  const blob = modelBlob(model);
  if (/composer/i.test(blob)) {
    return isFastVariant(model) ? 0 : 1;
  }
  if (/haiku/i.test(blob)) {
    return isFastVariant(model) ? 2 : 3;
  }
  return Number.POSITIVE_INFINITY;
}

/** Prefer a fast/cheap model so short utility prompts do not use chat-tier models. */
export function pickInexpensiveModel(models: InexpensiveModelOption[]): string {
  let best: { id: string; rank: number } | null = null;
  for (const model of models) {
    const rank = inexpensiveRank(model);
    if (!Number.isFinite(rank)) {
      continue;
    }
    if (!best || rank < best.rank) {
      best = { id: model.id, rank };
    }
  }
  return best?.id ?? 'auto';
}
