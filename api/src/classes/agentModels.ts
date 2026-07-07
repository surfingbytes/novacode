// node_modules
import { spawnSync } from 'node:child_process';
import stripAnsi from 'strip-ansi';

// classes
import { config } from './config';
import { getCursorModels } from './cursorModels';
import { getOpenCodeModels } from './openCodeModels';

// types
import type { AgentType } from '../@types/index';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const THINKING_VALUES = ['minimal', 'low', 'medium', 'high', 'max', 'fast', 'none'];
const CONTEXT_VALUES = ['32k', '64k', '128k', '200k', '256k', '1m', '2m'];

export interface AgentModelOption {
  id: string;
  label: string;
  model: string;
  thinking: string;
  context: string;
  fast: boolean | null;
  current?: boolean;
}

const cache = new Map<AgentType, { models: AgentModelOption[]; fetchedAt: number }>();

function titleToken(token: string): string {
  const lower = token.toLowerCase();
  if (lower === 'gpt') return 'GPT';
  if (lower === 'api') return 'API';
  if (/^\d/.test(token)) return token.toUpperCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function prettifyId(id: string): string {
  return id
    .split(/[/:_\-\s]+/)
    .filter(Boolean)
    .map(titleToken)
    .join(' ');
}

function parseConfiguredModelId(id: string): { baseId: string; config: Record<string, string> } | null {
  const match = id.match(/^([^\[]+)\[([^\]]+)\]$/);
  if (!match) return null;

  const config: Record<string, string> = {};
  for (const part of match[2].split(',')) {
    const [keyRaw, ...valueParts] = part.split('=');
    const key = keyRaw?.trim().toLowerCase();
    const value = valueParts.join('=').trim();
    if (key && value) config[key] = value;
  }

  return { baseId: match[1].trim(), config };
}

function normalizeContext(value: string | undefined): string {
  if (!value) return 'Default';
  const lower = value.toLowerCase();
  if (lower.endsWith('m')) return `${lower.slice(0, -1)}M`;
  if (lower.endsWith('k')) return `${lower.slice(0, -1)}K`;
  return titleToken(value);
}

function normalizeThinking(value: string | undefined): string {
  if (!value) return 'Default';
  return titleToken(value);
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
      thinking: normalizeThinking(configured.config['reasoning'] ?? configured.config['thinking']),
      context: normalizeContext(configured.config['context']),
      fast: normalizeFast(configured.config['fast'])
    };
  }

  const source = `${id} ${label}`.toLowerCase();
  const thinking = THINKING_VALUES.find((value) =>
    new RegExp(`(?:^|[\\s_\\-/])(?:thinking[\\s_\\-/]?)?${value}(?:$|[\\s_\\-/])`, 'i').test(source)
  );
  const context = CONTEXT_VALUES.find((value) =>
    new RegExp(`(?:^|[\\s_\\-/()])${value}(?:$|[\\s_\\-/()])`, 'i').test(source)
  );

  const rawTokens = id.split(/[/:_\-\s]+/).filter(Boolean);
  const modelTokens = rawTokens.filter((token) => {
    const lower = token.toLowerCase();
    return lower !== 'thinking' && !THINKING_VALUES.includes(lower) && !CONTEXT_VALUES.includes(lower);
  });
  const model = modelTokens.length > 0 ? modelTokens.map(titleToken).join(' ') : label;

  return {
    model,
    thinking: normalizeThinking(thinking),
    context: normalizeContext(context),
    fast: null
  };
}

function toAgentModelOption(option: { id: string; label: string; current?: boolean }): AgentModelOption {
  const id = option.id.trim();
  const label = (option.label || option.id).replace(/\s*\((current|default)\)\s*$/i, '').trim();
  return {
    id,
    label,
    ...(option.current ? { current: true } : {}),
    ...extractDimensions(id, label)
  };
}

function parseFlatModelsOutput(stdout: string): Array<{ id: string; label: string }> {
  const lines = stripAnsi(stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const models: Array<{ id: string; label: string }> = [];

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

function commandForAgent(agentType: AgentType): { command: string; args: string[] } | null {
  if (agentType === 'claude') return { command: config.claudeCommand, args: ['models'] };
  if (agentType === 'mistral-vibe') return { command: config.vibeCommand, args: ['models'] };
  if (agentType === 'codex') return { command: config.codexCommand, args: ['models'] };
  return null;
}

function getCliModels(agentType: AgentType): Array<{ id: string; label: string }> {
  const command = commandForAgent(agentType);
  if (!command) return [];

  const result = spawnSync(command.command, command.args, {
    encoding: 'utf8',
    timeout: 15_000,
    cwd: config.configDir,
    env: { ...process.env, ...config.agentEnv() },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const raw = [result.stdout, result.stderr].filter(Boolean).join('\n');
  return result.status === 0 && raw ? parseFlatModelsOutput(raw) : [];
}

export function getAgentModels(agentType: AgentType): { models: AgentModelOption[]; fromCache: boolean } {
  const now = Date.now();
  const cached = cache.get(agentType);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { models: cached.models, fromCache: true };
  }

  let rawModels: Array<{ id: string; label: string }> = [];
  if (agentType === 'cursor-agent') {
    rawModels = getCursorModels().models;
  } else if (agentType === 'open-code') {
    rawModels = getOpenCodeModels().models;
  } else {
    rawModels = getCliModels(agentType);
  }

  const withAuto = rawModels.some((model) => model.id === 'auto')
    ? rawModels
    : [{ id: 'auto', label: 'Auto' }, ...rawModels];
  const models = (withAuto.length > 0 ? withAuto : [{ id: 'auto', label: 'Auto' }]).map(toAgentModelOption);
  cache.set(agentType, { models, fetchedAt: now });
  return { models, fromCache: false };
}
