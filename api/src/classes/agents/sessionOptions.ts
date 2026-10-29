/**
 * Maps an ACP `session/new` response to the modes, config options and picker options Nova shows.
 */

// node_modules
import type { NewSessionResponse, SessionConfigOption, SessionModeState } from '@agentclientprotocol/sdk';

// classes
import { findContextToken, normalizeContext, prettifyId } from './modelOptions';

// types
import type {
  AgentConfigOption,
  AgentConfigSelectOption,
  AgentModelOption,
  AgentModeOption,
  AgentOptionsProbeResult,
  AgentThinkingOptionGroup,
} from './types';

/** Stored session mode meaning "whatever the agent defaults to". */
export const MODE_SENTINEL = 'default';

/** Mode and model have dedicated pickers; they are never listed as config options. */
const CONFIG_SKIP_CATEGORIES = new Set(['mode', 'model']);
const THINKING_CATEGORY_IDS = new Set(['thought_level', 'thinking', 'reasoning', 'effort']);

/** Modes endpoint mapping; [] when the agent reports none (caller falls back to static modes). */
export function modesFromSessionResponse(
  modes: { currentModeId: string; availableModes: Array<{ id: string; name: string; description?: string | null }> } | null | undefined,
  configOptions: Array<{ id: string; name: string; description?: string | null; category?: string | null; type: string; options?: unknown; currentValue?: string }> | null | undefined
): AgentModeOption[] {
  const discovered: AgentModeOption[] = [];
  const currentModeId = modes?.currentModeId;

  if (modes?.availableModes?.length) {
    for (const mode of modes.availableModes) {
      discovered.push({
        id: mode.id,
        label: mode.name,
        ...(mode.description ? { description: mode.description } : {}),
        ...(currentModeId === mode.id ? { current: true } : {}),
      });
    }
  }

  const modeConfig = configOptions?.find((o) => o.category === 'mode' || o.id === 'mode');
  if (modeConfig?.type === 'select' && Array.isArray(modeConfig.options)) {
    const flat = modeConfig.options as Array<{ value?: string; name?: string; description?: string | null; options?: Array<{ value: string; name: string; description?: string | null }> }>;
    for (const entry of flat) {
      if (entry.value && entry.name) {
        discovered.push({
          id: entry.value,
          label: entry.name,
          ...(entry.description ? { description: entry.description } : {}),
          ...(modeConfig.currentValue === entry.value || currentModeId === entry.value ? { current: true } : {}),
        });
      } else if (entry.options) {
        for (const nested of entry.options) {
          discovered.push({
            id: nested.value,
            label: nested.name,
            ...(nested.description ? { description: nested.description } : {}),
            ...(modeConfig.currentValue === nested.value || currentModeId === nested.value ? { current: true } : {}),
          });
        }
      }
    }
  }

  if (discovered.length === 0) return [];

  const deduped = new Map<string, AgentModeOption>();
  for (const mode of discovered) {
    const existing = deduped.get(mode.id);
    if (!existing || mode.current) deduped.set(mode.id, mode);
  }
  const unique = [...deduped.values()];

  if (!unique.some((m) => m.current) && currentModeId) {
    const match = unique.find((m) => m.id === currentModeId);
    if (match) match.current = true;
  }

  if (!unique.some((m) => m.current) && unique[0]) {
    unique[0].current = true;
  }

  return unique;
}

function flattenSelectOptions(
  option: SessionConfigOption & { type: 'select' }
): AgentConfigSelectOption[] {
  const opts = option.options;
  if (!Array.isArray(opts) || opts.length === 0) return [];
  const first = opts[0] as { value?: string; name?: string; options?: Array<{ value: string; name: string; description?: string | null }> };
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

/** Config options endpoint mapping (select options other than mode/model). */
export function configOptionsFromSession(
  configOptions: SessionConfigOption[] | null | undefined
): AgentConfigOption[] {
  if (!configOptions?.length) return [];

  const result: AgentConfigOption[] = [];
  for (const raw of configOptions) {
    if (raw.type !== 'select') continue;
    const category = raw.category ?? raw.id;
    if (CONFIG_SKIP_CATEGORIES.has(category) || CONFIG_SKIP_CATEGORIES.has(raw.id)) continue;

    const options = flattenSelectOptions(raw as SessionConfigOption & { type: 'select' });
    if (options.length === 0) continue;

    result.push({
      id: raw.id,
      label: raw.name,
      ...(raw.description ? { description: raw.description } : {}),
      ...(raw.category ? { category: raw.category } : {}),
      options,
      ...('currentValue' in raw && typeof raw.currentValue === 'string'
        ? { currentValue: raw.currentValue }
        : {}),
    });
  }
  return result;
}

function toAcpModelOption(option: { value: string; label: string; description?: string; current?: boolean }): AgentModelOption {
  return {
    id: option.value,
    label: option.label,
    model: option.label || prettifyId(option.value),
    thinking: 'Default',
    context: normalizeContext(
      findContextToken(`${option.value} ${option.label} ${option.description ?? ''}`.toLowerCase())
    ),
    fast: null,
    ...(option.current ? { current: true } : {}),
  };
}

/** Agent options mapping of modes (always marks one mode current). */
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
    const isModeOrModel = CONFIG_SKIP_CATEGORIES.has(category) || CONFIG_SKIP_CATEGORIES.has(raw.id);
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

/** Agent options from one `session/new` response. */
export function agentOptionsFromSession(resp: NewSessionResponse): AgentOptionsProbeResult {
  const configMapped = optionsFromConfigOptions(resp.configOptions);
  return {
    models: configMapped.models,
    modes: modesFromSession(resp.modes, resp.configOptions),
    configOptions: configMapped.configOptions,
    thinking: configMapped.thinking,
    source: 'acp',
  };
}

/** Fill empty models/modes from the agent's fallback model list, then static defaults. */
export async function withOptionFallbacks(
  options: AgentOptionsProbeResult | null,
  fallbackModels: () => Promise<AgentModelOption[]>
): Promise<AgentOptionsProbeResult> {
  const models = options?.models.length ? options.models : await fallbackModels();
  const fallbackMode = { id: MODE_SENTINEL, label: 'Default' };
  return {
    models: models.length > 0 ? models : [{ id: 'auto', label: 'Auto', model: 'Auto', thinking: 'Auto', context: 'Auto', fast: null }],
    modes: options?.modes.length ? options.modes : [fallbackMode],
    configOptions: options?.configOptions ?? [],
    thinking: options?.thinking ?? null,
    source: options?.source ?? (models.length > 0 ? 'mixed' : 'static'),
  };
}
