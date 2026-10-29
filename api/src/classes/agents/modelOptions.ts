/**
 * Model list normalisation shared by the models endpoint and the agent options probe.
 */

// node_modules
import stripAnsi from 'strip-ansi';

// types
import type { AgentModelOption, RawAgentModel } from './types';

const THINKING_VALUES = ['minimal', 'low', 'medium', 'high', 'max', 'xhigh', 'fast', 'none'];
const CONTEXT_TOKEN_RE = /^\d+(?:\.\d+)?[km]$/i;

export function findContextToken(source: string): string | undefined {
  const match = source.match(/(?:^|[\s_\-/()])(\d+(?:\.\d+)?[km])(?:$|[\s_\-/()])/i);
  return match?.[1]?.toLowerCase();
}

function titleToken(token: string): string {
  const lower = token.toLowerCase();
  if (lower === 'gpt') return 'GPT';
  if (lower === 'api') return 'API';
  if (/^\d/.test(token)) return token.toUpperCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function prettifyId(id: string): string {
  return id
    .split(/[/:_\-\s]+/)
    .filter(Boolean)
    .map(titleToken)
    .join(' ');
}

function parseConfiguredModelId(id: string): { baseId: string; config: Record<string, string> } | null {
  const match = id.match(/^([^[]+)\[([^\]]+)\]$/);
  if (!match) return null;

  const parsedConfig: Record<string, string> = {};
  for (const part of match[2].split(',')) {
    const [keyRaw, ...valueParts] = part.split('=');
    const key = keyRaw?.trim().toLowerCase();
    const value = valueParts.join('=').trim();
    if (key && value) parsedConfig[key] = value;
  }

  return { baseId: match[1].trim(), config: parsedConfig };
}

export function normalizeContext(value: string | undefined): string {
  if (!value) return 'Default';
  const lower = value.toLowerCase();
  if (lower.endsWith('m')) return `${lower.slice(0, -1)}M`;
  if (lower.endsWith('k')) return `${lower.slice(0, -1)}K`;
  return titleToken(value);
}

function normalizeThinking(value: string | undefined): string {
  if (!value) return 'Default';
  const lower = value.toLowerCase();
  if (lower === 'xhigh' || lower === 'extra-high' || lower === 'extra_high') return 'Extra High';
  return titleToken(value);
}

function thinkingFromConfig(configMap: Record<string, string>): string | undefined {
  return (
    configMap['reasoning'] ??
    configMap['reasoning_effort'] ??
    configMap['effort'] ??
    configMap['thinking']
  );
}

function normalizeFast(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  return null;
}

function extractDimensions(id: string, label: string): { model: string; thinking: string; context: string; fast: boolean | null } {
  if (id === 'auto') {
    return { model: 'Auto', thinking: 'Auto', context: 'Auto', fast: null };
  }

  const configured = parseConfiguredModelId(id) ?? parseConfiguredModelId(label);
  if (configured) {
    return {
      model: prettifyId(configured.baseId),
      thinking: normalizeThinking(thinkingFromConfig(configured.config)),
      context: normalizeContext(configured.config['context']),
      fast: normalizeFast(configured.config['fast']),
    };
  }

  const source = `${id} ${label}`.toLowerCase();
  const thinking = THINKING_VALUES.find((value) =>
    new RegExp(`(?:^|[\\s_\\-/])(?:thinking[\\s_\\-/]?)?${value}(?:$|[\\s_\\-/])`, 'i').test(source)
  );
  const context = findContextToken(source);

  const rawTokens = id.split(/[/:_\-\s]+/).filter(Boolean);
  const modelTokens = rawTokens.filter((token) => {
    const lower = token.toLowerCase();
    return lower !== 'thinking' && !THINKING_VALUES.includes(lower) && !CONTEXT_TOKEN_RE.test(lower);
  });

  return {
    model: modelTokens.length > 0 ? modelTokens.map(titleToken).join(' ') : label,
    thinking: normalizeThinking(thinking),
    context: normalizeContext(context),
    fast: null,
  };
}

export function toModelOption(option: RawAgentModel): AgentModelOption {
  const id = option.id.trim();
  const label = (option.label || option.id).replace(/\s*\((current|default)\)\s*$/i, '').trim();
  return {
    id,
    label,
    ...(option.current ? { current: true } : {}),
    ...extractDimensions(id, label),
  };
}

/** `<agent> models` output: `id - label` lines or bare ids. */
export function parseFlatModelsOutput(stdout: string): RawAgentModel[] {
  const lines = stripAnsi(stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const models: RawAgentModel[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/^[*•✓\-\s]+/, '').trim();
    if (!line || /^available models$/i.test(line) || /^tip:/i.test(line)) {
      continue;
    }

    const dashIdx = line.indexOf(' - ');
    if (dashIdx !== -1) {
      const id = line.slice(0, dashIdx).trim();
      const label = line.slice(dashIdx + 3).trim();
      if (id) models.push({ id, label });
      continue;
    }

    if (/^[a-z0-9][a-z0-9._:/,\-[\]=]*$/i.test(line)) {
      models.push({ id: line, label: prettifyId(line) });
    }
  }

  return models;
}
