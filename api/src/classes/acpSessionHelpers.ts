import type {
  LoadSessionResponse,
  NewSessionResponse,
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
} from '@agentclientprotocol/sdk';

export type AcpSessionResponse = NewSessionResponse | LoadSessionResponse;

/** Minimal client surface for applying session mode/model config. */
export interface AcpSessionConfigClient {
  setSessionMode?(params: { sessionId: string; modeId: string }): Promise<unknown>;
  setSessionConfigOption?(params: {
    sessionId: string;
    configId: string;
    value: string;
  }): Promise<unknown>;
}

const SESSION_CONFIG_APPLY_TIMEOUT_MS = 2_500;

async function withApplyTimeout<T>(label: string, promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${SESSION_CONFIG_APPLY_TIMEOUT_MS}ms`)),
          SESSION_CONFIG_APPLY_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isSelectConfigOption(
  option: SessionConfigOption
): option is SessionConfigOption & { type: 'select' } {
  return option.type === 'select';
}

function flattenSelectValues(option: SessionConfigOption & { type: 'select' }): string[] {
  const opts = option.options;
  if (!Array.isArray(opts) || opts.length === 0) return [];
  const first = opts[0] as SessionConfigSelectOption | SessionConfigSelectGroup;
  if ('value' in first) {
    return (opts as SessionConfigSelectOption[]).map((o) => o.value);
  }
  return (opts as SessionConfigSelectGroup[]).flatMap((group) =>
    group.options.map((o) => o.value)
  );
}

export function findConfigOptionByCategory(
  configOptions: SessionConfigOption[] | null | undefined,
  category: string
): (SessionConfigOption & { type: 'select' }) | null {
  if (!configOptions?.length) return null;
  const match =
    configOptions.find((o) => o.category === category) ??
    configOptions.find((o) => o.id === category);
  if (!match || !isSelectConfigOption(match)) return null;
  return match;
}

export async function applySessionMode(
  conn: AcpSessionConfigClient,
  sessionId: string,
  mode: string | undefined,
  sessionResponse: AcpSessionResponse
): Promise<void> {
  const trimmed = mode?.trim();
  if (!trimmed || trimmed === 'default') return;

  const currentModeId = sessionResponse.modes?.currentModeId;
  if (currentModeId === trimmed) return;

  const availableModeIds = sessionResponse.modes?.availableModes?.map((m) => m.id) ?? [];
  if (availableModeIds.includes(trimmed) && conn.setSessionMode) {
    try {
      await withApplyTimeout(
        `setSessionMode(${trimmed})`,
        conn.setSessionMode({ sessionId, modeId: trimmed })
      );
      return;
    } catch (err) {
      console.warn('[acpSessionHelpers] setSessionMode failed (non-fatal):', err);
    }
  }

  const modeOption = findConfigOptionByCategory(sessionResponse.configOptions, 'mode');
  if (!modeOption || !conn.setSessionConfigOption) return;

  const values = flattenSelectValues(modeOption);
  if (!values.includes(trimmed) && modeOption.id !== 'mode') return;

  try {
    await withApplyTimeout(
      `setSessionConfigOption(${modeOption.id})`,
      conn.setSessionConfigOption({
        sessionId,
        configId: modeOption.id,
        value: trimmed,
      })
    );
  } catch (err) {
    console.warn('[acpSessionHelpers] setSessionConfigOption(mode) failed (non-fatal):', err);
  }
}

export async function applySessionModel(
  conn: AcpSessionConfigClient,
  sessionId: string,
  model: string | undefined,
  sessionResponse: AcpSessionResponse
): Promise<void> {
  const trimmed = model?.trim();
  if (!trimmed || trimmed === 'auto') return;

  const modelOption = findConfigOptionByCategory(sessionResponse.configOptions, 'model');
  if (!modelOption || !conn.setSessionConfigOption) return;

  const values = flattenSelectValues(modelOption);
  if (values.length > 0 && !values.includes(trimmed)) return;

  try {
    await withApplyTimeout(
      `setSessionConfigOption(${modelOption.id})`,
      conn.setSessionConfigOption({
        sessionId,
        configId: modelOption.id,
        value: trimmed,
      })
    );
  } catch (err) {
    console.warn('[acpSessionHelpers] setSessionConfigOption(model) failed (non-fatal):', err);
  }
}

export async function applySessionConfig(
  conn: AcpSessionConfigClient,
  sessionId: string,
  config: Record<string, string> | undefined,
  sessionResponse: AcpSessionResponse
): Promise<void> {
  if (!config || !conn.setSessionConfigOption) return;

  for (const [configId, value] of Object.entries(config)) {
    const trimmed = value?.trim();
    if (!trimmed) continue;

    const option =
      sessionResponse.configOptions?.find((o) => o.id === configId) ??
      findConfigOptionByCategory(sessionResponse.configOptions, configId);
    if (option && isSelectConfigOption(option)) {
      const values = flattenSelectValues(option);
      if (values.length > 0 && !values.includes(trimmed)) continue;
    }

    try {
      await withApplyTimeout(
        `setSessionConfigOption(${configId})`,
        conn.setSessionConfigOption({ sessionId, configId, value: trimmed })
      );
    } catch (err) {
      console.warn(`[acpSessionHelpers] setSessionConfigOption(${configId}) failed (non-fatal):`, err);
    }
  }
}
