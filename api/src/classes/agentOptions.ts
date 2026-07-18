// node_modules
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import stripAnsi from 'strip-ansi';
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk';
import type {
  AgentSideConnection,
  NewSessionResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionModeState,
} from '@agentclientprotocol/sdk';

// classes
import { config } from './config';
import { getCursorModels } from './cursorModels';
import { getOpenCodeModels } from './openCodeModels';
import { getAgentModes, MODE_SENTINEL } from './agentModes';
import { getAgentConfigOptions } from './agentConfigOptions';

// types
import type { AgentType } from '../@types/index';
import type { AgentModelOption } from './agentModels';
import type { AgentModeOption } from './agentModes';
import type { AgentConfigOption, AgentConfigSelectOption } from './agentConfigOptions';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const THINKING_VALUES = ['minimal', 'low', 'medium', 'high', 'max', 'fast', 'none'];
const CONTEXT_VALUES = ['32k', '64k', '128k', '200k', '256k', '1m', '2m'];
const THINKING_CATEGORY_IDS = new Set(['thought_level', 'thinking', 'reasoning', 'effort']);
const SKIP_CONFIG_IDS = new Set(['mode', 'model']);

export interface AgentThinkingOptionGroup {
  configId: string;
  label: string;
  description?: string;
  options: AgentConfigSelectOption[];
  currentValue?: string;
}

export interface AgentOptionsResponse {
  models: AgentModelOption[];
  modes: AgentModeOption[];
  configOptions: AgentConfigOption[];
  thinking: AgentThinkingOptionGroup | null;
  fromCache: boolean;
  source: 'cli' | 'acp' | 'mixed' | 'static';
}

const cache = new Map<string, { options: Omit<AgentOptionsResponse, 'fromCache'>; fetchedAt: number }>();

function autoApprovePermission(params: RequestPermissionRequest): RequestPermissionResponse {
  const allowOption = params.options.find(
    (o) => o.kind === 'allow_once' || o.kind === 'allow_always'
  );
  if (allowOption) {
    return { outcome: { outcome: 'selected', optionId: allowOption.optionId } };
  }
  return { outcome: { outcome: 'cancelled' } };
}

function nodeReadableToWeb(readable: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      readable.on('data', (chunk: Buffer | string) => {
        controller.enqueue(typeof chunk === 'string' ? Buffer.from(chunk) : new Uint8Array(chunk));
      });
      readable.on('end', () => controller.close());
      readable.on('error', (err) => controller.error(err));
    },
  });
}

function nodeWritableToWeb(writable: NodeJS.WritableStream): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        writable.write(chunk, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        writable.end(resolve);
      });
    },
  });
}

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

  const parsedConfig: Record<string, string> = {};
  for (const part of match[2].split(',')) {
    const [keyRaw, ...valueParts] = part.split('=');
    const key = keyRaw?.trim().toLowerCase();
    const value = valueParts.join('=').trim();
    if (key && value) parsedConfig[key] = value;
  }

  return { baseId: match[1].trim(), config: parsedConfig };
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
      fast: normalizeFast(configured.config['fast']),
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

  return {
    model: modelTokens.length > 0 ? modelTokens.map(titleToken).join(' ') : label,
    thinking: normalizeThinking(thinking),
    context: normalizeContext(context),
    fast: null,
  };
}

function toModelOption(option: { id: string; label: string; current?: boolean }): AgentModelOption {
  const id = option.id.trim();
  const label = (option.label || option.id).replace(/\s*\((current|default)\)\s*$/i, '').trim();
  return {
    id,
    label,
    ...(option.current ? { current: true } : {}),
    ...extractDimensions(id, label),
  };
}

function toAcpModelOption(option: { value: string; label: string; description?: string; current?: boolean }): AgentModelOption {
  return {
    id: option.value,
    label: option.label,
    model: option.label || prettifyId(option.value),
    thinking: 'Default',
    context: normalizeContext(
      CONTEXT_VALUES.find((value) =>
        new RegExp(`(?:^|[\\s_\\-/()])${value}(?:$|[\\s_\\-/()])`, 'i').test(
          `${option.value} ${option.label} ${option.description ?? ''}`
        )
      )
    ),
    fast: null,
    ...(option.current ? { current: true } : {}),
  };
}

function flattenSelectOptions(option: SessionConfigOption & { type: 'select' }): AgentConfigSelectOption[] {
  const opts = option.options;
  if (!Array.isArray(opts) || opts.length === 0) return [];
  const first = opts[0] as {
    value?: string;
    name?: string;
    options?: Array<{ value: string; name: string; description?: string | null }>;
  };
  if ('value' in first && first.value && first.name) {
    return (opts as Array<{ value: string; name: string; description?: string | null }>).map((o) => ({
      value: o.value,
      label: o.name,
      ...(o.description ? { description: o.description } : {}),
    }));
  }
  return (opts as Array<{ options: Array<{ value: string; name: string; description?: string | null }> }>).flatMap(
    (group) =>
      group.options.map((o) => ({
        value: o.value,
        label: o.name,
        ...(o.description ? { description: o.description } : {}),
      }))
  );
}

function modesFromSession(
  modes: SessionModeState | null | undefined,
  configOptions: SessionConfigOption[] | null | undefined
): AgentModeOption[] {
  const discovered: AgentModeOption[] = [];
  const currentModeId = modes?.currentModeId;

  for (const mode of modes?.availableModes ?? []) {
    discovered.push({
      id: mode.id,
      label: mode.name,
      ...(mode.description ? { description: mode.description } : {}),
      ...(currentModeId === mode.id ? { current: true } : {}),
    });
  }

  const modeConfig = configOptions?.find((o) => o.category === 'mode' || o.id === 'mode');
  if (modeConfig?.type === 'select') {
    for (const opt of flattenSelectOptions(modeConfig)) {
      discovered.push({
        id: opt.value,
        label: opt.label,
        ...(opt.description ? { description: opt.description } : {}),
        ...(modeConfig.currentValue === opt.value || currentModeId === opt.value ? { current: true } : {}),
      });
    }
  }

  const deduped = new Map<string, AgentModeOption>();
  for (const mode of discovered) {
    const existing = deduped.get(mode.id);
    if (!existing || mode.current) deduped.set(mode.id, mode);
  }
  const unique = [...deduped.values()];
  if (!unique.some((m) => m.current) && unique[0]) unique[0].current = true;
  return unique;
}

function optionsFromConfigOptions(configOptions: SessionConfigOption[] | null | undefined): {
  models: AgentModelOption[];
  thinking: AgentThinkingOptionGroup | null;
  configOptions: AgentConfigOption[];
} {
  const modelConfig = configOptions?.find((o) => o.category === 'model' || o.id === 'model');
  const models =
    modelConfig?.type === 'select'
      ? flattenSelectOptions(modelConfig).map((o) =>
          toAcpModelOption({
            value: o.value,
            label: o.label,
            ...(o.description ? { description: o.description } : {}),
            current: modelConfig.currentValue === o.value,
          })
        )
      : [];

  let thinking: AgentThinkingOptionGroup | null = null;
  const configResult: AgentConfigOption[] = [];
  for (const raw of configOptions ?? []) {
    if (raw.type !== 'select') continue;
    const category = raw.category ?? raw.id;
    const isModeOrModel = SKIP_CONFIG_IDS.has(category) || SKIP_CONFIG_IDS.has(raw.id);
    if (isModeOrModel) continue;

    const flat = flattenSelectOptions(raw);
    if (flat.length === 0) continue;

    const normalized: AgentConfigOption = {
      id: raw.id,
      label: raw.name,
      ...(raw.description ? { description: raw.description } : {}),
      ...(raw.category ? { category: raw.category } : {}),
      options: flat,
      ...('currentValue' in raw && typeof raw.currentValue === 'string'
        ? { currentValue: raw.currentValue }
        : {}),
    };

    const isThinking = THINKING_CATEGORY_IDS.has(category) || THINKING_CATEGORY_IDS.has(raw.id);
    if (isThinking && !thinking) {
      thinking = {
        configId: normalized.id,
        label: normalized.label,
        ...(normalized.description ? { description: normalized.description } : {}),
        options: normalized.options,
        ...(normalized.currentValue ? { currentValue: normalized.currentValue } : {}),
      };
      continue;
    }

    configResult.push(normalized);
  }

  return { models, thinking, configOptions: configResult };
}

function spawnCommandForAgent(agentType: AgentType): { command: string; args: string[] } | null {
  if (agentType === 'mistral-vibe') return { command: config.vibeAcpCommand, args: [] };
  if (agentType === 'open-code') return { command: config.openCodeAcpCommand, args: ['acp'] };
  if (agentType === 'codex') return { command: config.codexAcpCommand, args: ['acp'] };
  return null;
}

async function probeSubprocessAcpOptions(agentType: AgentType): Promise<Omit<AgentOptionsResponse, 'fromCache'> | null> {
  const spawnSpec = spawnCommandForAgent(agentType);
  if (!spawnSpec) return null;

  const env = { ...process.env, ...config.agentEnv() };
  let proc: ChildProcess;
  try {
    proc = spawn(spawnSpec.command, spawnSpec.args, {
      cwd: config.configDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
  } catch {
    return null;
  }

  const killProc = () => {
    try {
      proc.kill();
    } catch {
      // already dead
    }
  };

  try {
    const stream = ndJsonStream(nodeWritableToWeb(proc.stdin!), nodeReadableToWeb(proc.stdout!));
    const app = client({ name: 'nova-code' }).onRequest(
      methods.client.session.requestPermission,
      ({ params }) => autoApprovePermission(params)
    );

    return await app.connectWith(stream, async (ctx) => {
      await ctx.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'nova-code', version: '1.0.0' },
        clientCapabilities: {},
      });
      const resp = (await ctx.request(methods.agent.session.new, {
        cwd: config.configDir,
        mcpServers: [],
      })) as NewSessionResponse;
      const configMapped = optionsFromConfigOptions(resp.configOptions);
      return {
        models: configMapped.models,
        modes: modesFromSession(resp.modes, resp.configOptions),
        configOptions: configMapped.configOptions,
        thinking: configMapped.thinking,
        source: 'acp',
      };
    });
  } catch {
    return null;
  } finally {
    killProc();
  }
}

const claudeClientProxy = {
  sessionUpdate: async (): Promise<void> => {},
  requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> =>
    autoApprovePermission(params),
  readTextFile: async (): Promise<{ content: string }> => ({ content: '' }),
  writeTextFile: async (): Promise<Record<string, never>> => ({}),
  createTerminal: async (): Promise<never> => {
    throw new Error('[agentOptions] createTerminal not supported during probe');
  },
} satisfies Partial<AgentSideConnection>;

// Keep this as a true dynamic import: the Claude ACP package is ESM-only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const esmImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;

async function probeClaudeOptions(claudeToken?: string | null): Promise<Omit<AgentOptionsResponse, 'fromCache'> | null> {
  try {
    if (claudeToken) {
      process.env['CLAUDE_CODE_OAUTH_TOKEN'] = claudeToken;
    }
    const { ClaudeAcpAgent } = await esmImport('@agentclientprotocol/claude-agent-acp');
    const agent = new ClaudeAcpAgent(claudeClientProxy as unknown as AgentSideConnection);
    await agent.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'nova-code', version: '1.0.0' },
      clientCapabilities: {},
    });
    const resp = (await agent.newSession({
      cwd: config.configDir,
      mcpServers: [],
    })) as NewSessionResponse;
    const configMapped = optionsFromConfigOptions(resp.configOptions);
    await agent.closeSession({ sessionId: resp.sessionId }).catch(() => {});
    return {
      models: configMapped.models,
      modes: modesFromSession(resp.modes, resp.configOptions),
      configOptions: configMapped.configOptions,
      thinking: configMapped.thinking,
      source: 'acp',
    };
  } catch {
    return null;
  }
}

function fallbackCliModels(agentType: AgentType): AgentModelOption[] {
  if (agentType === 'open-code') {
    return getOpenCodeModels().models.map((m) => toModelOption({ id: m.id, label: m.label }));
  }

  const command =
    agentType === 'mistral-vibe'
      ? { command: config.vibeCommand, args: ['models'] }
      : agentType === 'codex'
        ? { command: config.codexCommand, args: ['models'] }
        : null;
  if (!command) return [];

  const result = spawnSync(command.command, command.args, {
    encoding: 'utf8',
    timeout: 15_000,
    cwd: config.configDir,
    env: { ...process.env, ...config.agentEnv() },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const raw = stripAnsi([result.stdout, result.stderr].filter(Boolean).join('\n'));
  if (result.status !== 0 || !raw) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[a-z0-9][a-z0-9._:/,\-[\]=]*$/i.test(line))
    .map((id) => toModelOption({ id, label: prettifyId(id) }));
}

async function cursorOptions(): Promise<Omit<AgentOptionsResponse, 'fromCache'>> {
  const [modes, configOptions] = await Promise.all([
    getAgentModes('cursor-agent'),
    getAgentConfigOptions('cursor-agent'),
  ]);
  return {
    models: getCursorModels().models.map((m) =>
      toModelOption({ id: m.id, label: m.label, ...(m.current ? { current: m.current } : {}) })
    ),
    modes: modes.modes,
    configOptions: configOptions.options,
    thinking: null,
    source: 'cli',
  };
}

function withFallbacks(
  agentType: AgentType,
  options: Omit<AgentOptionsResponse, 'fromCache'> | null
): Omit<AgentOptionsResponse, 'fromCache'> {
  const models = options?.models.length ? options.models : fallbackCliModels(agentType);
  const fallbackMode = { id: MODE_SENTINEL, label: 'Default' };
  return {
    models: models.length > 0 ? models : [{ id: 'auto', label: 'Auto', model: 'Auto', thinking: 'Auto', context: 'Auto', fast: null }],
    modes: options?.modes.length ? options.modes : [fallbackMode],
    configOptions: options?.configOptions ?? [],
    thinking: options?.thinking ?? null,
    source: options?.source ?? (models.length > 0 ? 'mixed' : 'static'),
  };
}

export async function getAgentOptions(
  agentType: AgentType,
  opts?: { claudeToken?: string | null }
): Promise<AgentOptionsResponse> {
  const now = Date.now();
  const cacheKey = agentType === 'claude'
    ? `${agentType}:${opts?.claudeToken ? 'auth' : 'anon'}`
    : agentType;
  const cached = cache.get(cacheKey);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { ...cached.options, fromCache: true };
  }

  const options =
    agentType === 'cursor-agent'
      ? await cursorOptions()
      : agentType === 'claude'
        ? withFallbacks(agentType, await probeClaudeOptions(opts?.claudeToken))
        : withFallbacks(agentType, await probeSubprocessAcpOptions(agentType));

  cache.set(cacheKey, { options, fetchedAt: now });
  return { ...options, fromCache: false };
}
