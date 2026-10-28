// node_modules
import { methods } from '@agentclientprotocol/sdk';
import type {
  ClientContext,
  LoadSessionResponse,
  NewSessionResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  SessionNotification,
} from '@agentclientprotocol/sdk';

// classes
import { logger } from './logger';

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
      logger.warn({ err, sessionId, mode: trimmed }, 'setSessionMode failed (non-fatal)');
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
    logger.warn({ err, sessionId, mode: trimmed }, 'setSessionConfigOption(mode) failed (non-fatal)');
  }
}

/** Model id without any `[..]` variant suffix, lowercased for tolerant matching. */
function baseModelId(value: string): string {
  return value.split('[')[0]!.trim().toLowerCase();
}

export async function applySessionModel(
  conn: AcpSessionConfigClient,
  sessionId: string,
  model: string | undefined,
  sessionResponse: AcpSessionResponse
): Promise<void> {
  const trimmed = model?.trim();
  if (!trimmed) return;

  const modelOption = findConfigOptionByCategory(sessionResponse.configOptions, 'model');
  if (!modelOption || !conn.setSessionConfigOption) {
    logger.debug({ requested: trimmed }, 'no model config option available; cannot apply model');
    return;
  }

  const values = flattenSelectValues(modelOption);
  // Resolve to the exact string Cursor accepts: prefer an exact match, then the same base model
  // id (handles CLI ids vs ACP values that differ only by a `[..]` variant suffix), then `auto`.
  let target: string | undefined;
  if (values.includes(trimmed)) {
    target = trimmed;
  } else {
    target = values.find((v) => baseModelId(v) === baseModelId(trimmed));
  }
  if (!target && values.length === 0) target = trimmed;
  if (!target) {
    logger.debug({ requested: trimmed, availableCount: values.length }, 'requested model not offered by agent; leaving default');
    return;
  }

  const currentValue =
    'currentValue' in modelOption && typeof modelOption.currentValue === 'string'
      ? modelOption.currentValue
      : undefined;
  if (currentValue === target) return;

  try {
    await withApplyTimeout(
      `setSessionConfigOption(${modelOption.id}=${target})`,
      conn.setSessionConfigOption({
        sessionId,
        configId: modelOption.id,
        value: target,
      })
    );
    logger.debug({ configId: modelOption.id, value: target }, 'applied model');
  } catch (err) {
    logger.warn({ err, sessionId, configId: modelOption.id, value: target }, 'setSessionConfigOption(model) failed (non-fatal)');
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
      logger.warn({ err, sessionId, configId }, 'setSessionConfigOption failed (non-fatal)');
    }
  }
}

// ---- ACP client wiring ----

export type AcpEventHandler = (line: string) => void;
export type AcpPermissionHandler = (
  params: RequestPermissionRequest
) => RequestPermissionResponse | Promise<RequestPermissionResponse>;

export type SessionConfigSyncHandler = (sync: {
  modeId?: string;
  modelId?: string;
  config?: Record<string, string>;
}) => void;

export function autoApprovePermission(
  params: RequestPermissionRequest
): RequestPermissionResponse {
  const allowOption = params.options.find(
    (o) => o.kind === 'allow_once' || o.kind === 'allow_always'
  );
  if (allowOption) {
    return { outcome: { outcome: 'selected', optionId: allowOption.optionId } };
  }
  return { outcome: { outcome: 'cancelled' } };
}

export function extractConfigSync(update: SessionNotification['update'], sync?: SessionConfigSyncHandler): void {
  if (!sync) return;
  if (update.sessionUpdate === 'current_mode_update') {
    sync({ modeId: update.currentModeId });
    return;
  }
  if (update.sessionUpdate === 'config_option_update') {
    const modelOpt = update.configOptions.find((o) => o.category === 'model' || o.id === 'model');
    if (modelOpt?.type === 'select' && 'currentValue' in modelOpt && typeof modelOpt.currentValue === 'string') {
      sync({ modelId: modelOpt.currentValue });
    }
    const config: Record<string, string> = {};
    for (const opt of update.configOptions) {
      if (opt.type !== 'select') continue;
      const cat = opt.category ?? opt.id;
      if (cat === 'mode' || cat === 'model' || opt.id === 'mode' || opt.id === 'model') continue;
      if ('currentValue' in opt && typeof opt.currentValue === 'string') {
        config[opt.id] = opt.currentValue;
      }
    }
    if (Object.keys(config).length > 0) {
      sync({ config });
    }
  }
}

export function emitSessionConfigSync(
  onEvent: AcpEventHandler,
  sync: { modeId?: string; modelId?: string; config?: Record<string, string> }
): void {
  if (!sync.modeId && !sync.modelId && !sync.config) return;
  onEvent(JSON.stringify({ type: 'session_config_sync', ...sync }));
}

export function handleSessionNotification(
  notification: SessionNotification,
  onEvent: AcpEventHandler,
  onConfigSync?: SessionConfigSyncHandler
): void {
  extractConfigSync(notification.update, (sync) => {
    onConfigSync?.(sync);
    emitSessionConfigSync(onEvent, sync);
  });
  onEvent(JSON.stringify(notification));
}

export function acpAgent(ctx: ClientContext) {
  return {
    request: (method: string, params: unknown) => ctx.request(method, params as never),
    notify: (method: string, params: unknown) => ctx.notify(method, params as never),
    setSessionMode: (params: { sessionId: string; modeId: string }) =>
      ctx.request(methods.agent.session.setMode, params),
    setSessionConfigOption: (params: { sessionId: string; configId: string; value: string }) =>
      ctx.request(methods.agent.session.setConfigOption, { ...params, type: 'select' as const }),
    closeSession: (params: { sessionId: string }) => ctx.request(methods.agent.session.close, params),
    deleteSession: (params: { sessionId: string }) => ctx.request(methods.agent.session.delete, params),
    cancel: (params: { sessionId: string }) => ctx.notify(methods.agent.session.cancel, params),
  };
}

// ---- Record helpers ----

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function recordHasTrue(obj: Record<string, unknown> | null, keys: string[]): boolean {
  if (!obj) return false;
  for (const key of keys) {
    if (obj[key] === true) return true;
  }
  return false;
}
