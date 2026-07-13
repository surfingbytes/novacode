/**
 * Shared subprocess ACP runner using SDK 1.2 ClientApp (replaces ClientSideConnection).
 */

// node_modules
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk';
import type {
  ClientContext,
  LoadSessionResponse,
  NewSessionResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk';

// classes
import { config } from './config';
import { applySessionMode, applySessionModel, applySessionConfig, findConfigOptionByCategory } from './acpSessionHelpers';
import type { AcpSessionResponse } from './acpSessionHelpers';

export type AcpEventHandler = (line: string) => void;

export type SessionConfigSyncHandler = (sync: {
  modeId?: string;
  modelId?: string;
  config?: Record<string, string>;
}) => void;

export interface AcpSubprocessRunParams {
  command: string;
  args: string[];
  cwd: string;
  novaSessionId: string;
  acpSessionId: string | null;
  promptText: string;
  model?: string;
  mode?: string;
  configJson?: Record<string, string>;
  logTag: string;
  /** Handle Cursor-specific extension requests via ctx.request(). */
  cursorExtensions?: boolean;
  /**
   * Skip applying the model via ACP setSessionConfigOption. Cursor's ACP ignores runtime model
   * config changes for actual inference (a known cursor-agent bug), so Cursor passes the model as
   * a `--model` startup arg instead and sets this flag to avoid a redundant/ineffective config write.
   */
  skipModelConfigOption?: boolean;
}

export interface AcpSubprocessRunResult {
  acpSessionId: string;
  stopReason?: string;
  error?: string;
  /** Resolved mode after session create/load when DB had sentinel `default`. */
  resolvedModeId?: string;
  resolvedModelId?: string;
}

interface ActiveRun {
  cancel: () => void;
  acpSessionId: string | null;
}

const activeRuns = new Map<string, ActiveRun>();
const activeHandlers = new Map<string, AcpEventHandler>();
const configSyncHandlers = new Map<string, SessionConfigSyncHandler>();

function autoApprovePermission(
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

function extractConfigSync(update: SessionNotification['update'], sync?: SessionConfigSyncHandler): void {
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

function emitSessionConfigSync(
  onEvent: AcpEventHandler,
  sync: { modeId?: string; modelId?: string; config?: Record<string, string> }
): void {
  if (!sync.modeId && !sync.modelId && !sync.config) return;
  onEvent(JSON.stringify({ type: 'session_config_sync', ...sync }));
}

function handleSessionNotification(
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

interface CursorPlanEntry {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

function normalizeCursorPlanStatus(status: unknown): CursorPlanEntry['status'] {
  if (typeof status !== 'string') {
    return 'pending';
  }
  const normalized = status.toLowerCase().replace(/^todo_status_/, '');
  if (normalized === 'completed' || normalized === 'done') {
    return 'completed';
  }
  if (normalized === 'in_progress' || normalized === 'in-progress' || normalized === 'running') {
    return 'in_progress';
  }
  return 'pending';
}

function cursorPlanEntryFromUnknown(value: unknown): CursorPlanEntry | null {
  if (typeof value === 'string') {
    const content = value.trim();
    return content ? { content, status: 'pending' } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const obj = value as Record<string, unknown>;
  const rawContent = obj.content ?? obj.text ?? obj.title ?? obj.description ?? obj.name;
  if (typeof rawContent !== 'string') {
    return null;
  }

  const content = rawContent.trim();
  if (!content) {
    return null;
  }

  return {
    content,
    status: normalizeCursorPlanStatus(obj.status),
  };
}

function extractCursorPlanEntries(params: unknown): CursorPlanEntry[] {
  if (typeof params === 'string' || Array.isArray(params)) {
    const values = Array.isArray(params) ? params : [params];
    return values
      .map(cursorPlanEntryFromUnknown)
      .filter((entry): entry is CursorPlanEntry => entry !== null);
  }

  if (!params || typeof params !== 'object') {
    return [];
  }

  const obj = params as Record<string, unknown>;
  for (const key of ['entries', 'steps', 'todos', 'items', 'plan']) {
    const value = obj[key];
    if (Array.isArray(value)) {
      return value
        .map(cursorPlanEntryFromUnknown)
        .filter((entry): entry is CursorPlanEntry => entry !== null);
    }
  }

  if (obj.plan && typeof obj.plan === 'object') {
    const nestedEntries = extractCursorPlanEntries(obj.plan);
    if (nestedEntries.length > 0) {
      return nestedEntries;
    }
  }

  const singleEntry = cursorPlanEntryFromUnknown(obj.plan ?? obj.content ?? obj.text ?? obj.title);
  return singleEntry ? [singleEntry] : [];
}

function emitCursorPlanRequest(
  params: unknown,
  getSessionId: () => string | null
): void {
  const entries = extractCursorPlanEntries(params);
  if (entries.length === 0) {
    return;
  }

  const sessionId = getSessionId();
  if (!sessionId) {
    return;
  }

  const handler = activeHandlers.get(sessionId);
  if (!handler) {
    return;
  }

  handler(
    JSON.stringify({
      sessionId,
      update: {
        sessionUpdate: 'plan',
        entries,
      },
    })
  );
}

function buildClientApp(
  onConfigSync?: SessionConfigSyncHandler,
  cursorExtensions?: boolean,
  getActiveSessionId: () => string | null = () => null
) {
  let app = client({ name: 'nova-code' })
    .onNotification(methods.client.session.update, ({ params }) => {
      const handler = activeHandlers.get(params.sessionId);
      if (handler) {
        handleSessionNotification(params, handler, onConfigSync);
      }
    })
    .onRequest(methods.client.session.requestPermission, ({ params }) => autoApprovePermission(params))
    .onRequest(methods.client.fs.readTextFile, async () => ({ content: '' }))
    .onRequest(methods.client.fs.writeTextFile, async () => ({}));

  if (cursorExtensions) {
    // Cursor ACP extension methods are not in the core ClientRequestMethod union.
    const parseUnknown = (params: unknown): unknown => params;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extApp = app as any;
    extApp
      .onRequest('cursor/ask_question', parseUnknown, async () => ({
        outcome: { outcome: 'skipped', reason: 'Nova Code does not support interactive questions yet.' },
      }))
      .onRequest('cursor/create_plan', parseUnknown, async ({ params }: { params: unknown }) => {
        emitCursorPlanRequest(params, getActiveSessionId);
        return { outcome: { outcome: 'accepted' } };
      })
      .onRequest('cursor/update_todos', parseUnknown, async ({ params }: { params: unknown }) => ({
        outcome: {
          outcome: 'accepted',
          todos: Array.isArray((params as { todos?: unknown }).todos)
            ? (params as { todos: unknown[] }).todos
            : [],
        },
      }))
      .onRequest('cursor/task', parseUnknown, async () => ({ outcome: { outcome: 'completed' } }))
      .onRequest('cursor/generate_image', parseUnknown, async () => ({
        outcome: { outcome: 'rejected', reason: 'Nova Code does not support image generation yet.' },
      }));
  }

  return app;
}

function acpAgent(ctx: ClientContext) {
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

function createPhaseLogger(logTag: string, novaSessionId: string) {
  let last = Date.now();
  return (phase: string): void => {
    const now = Date.now();
    console.log(`[${logTag}] ${phase}`, {
      novaSessionId,
      elapsedMs: now - last,
    });
    last = now;
  };
}

export async function runAcpSubprocessPrompt(
  params: AcpSubprocessRunParams,
  onEvent: AcpEventHandler,
  onConfigSync?: SessionConfigSyncHandler
): Promise<AcpSubprocessRunResult> {
  const { command, args, cwd, novaSessionId, acpSessionId, promptText, logTag } = params;
  const env = { ...process.env, ...config.agentEnv() };
  const phase = createPhaseLogger(logTag, novaSessionId);

  let proc: ChildProcess;
  try {
    proc = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env });
    phase('spawned');
  } catch (err) {
    return { acpSessionId: acpSessionId ?? '', error: String(err) };
  }

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.error(`[${logTag}] stderr:`, text);
  });

  let ctxRef: ClientContext | null = null;
  let sessionIdForCancel: string | null = acpSessionId;
  const stream = ndJsonStream(nodeWritableToWeb(proc.stdin!), nodeReadableToWeb(proc.stdout!));
  const app = buildClientApp(onConfigSync, params.cursorExtensions, () => sessionIdForCancel);

  const killProc = () => {
    try {
      proc.kill('SIGTERM');
    } catch {
      // already dead
    }
    setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // already dead
      }
    }, 2000);
  };

  const cancelRun = () => {
    void (async () => {
      if (ctxRef && sessionIdForCancel) {
        try {
          await ctxRef.notify(methods.agent.session.cancel, { sessionId: sessionIdForCancel });
        } catch {
          // ignore
        }
      }
      killProc();
    })();
  };

  activeRuns.set(novaSessionId, {
    cancel: cancelRun,
    get acpSessionId() {
      return sessionIdForCancel;
    },
  });

  if (onConfigSync) {
    configSyncHandlers.set(novaSessionId, onConfigSync);
  }

  try {
    return await app.connectWith(stream, async (ctx) => {
      ctxRef = ctx;
      const agent = acpAgent(ctx);

      phase('initialize:start');
      await ctx.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'nova-code', version: '1.0.0' },
        clientCapabilities: params.cursorExtensions
          ? { fs: { readTextFile: false, writeTextFile: false }, terminal: false }
          : { session: { configOptions: { boolean: true } } },
      });
      phase('initialize:done');

      let resolvedSessionId: string;
      let sessionResponse: AcpSessionResponse;
      let resolvedModeId: string | undefined;
      let resolvedModelId: string | undefined;

      if (!acpSessionId) {
        phase('session:new:start');
        const created = (await ctx.request(methods.agent.session.new, {
          cwd,
          mcpServers: [],
        })) as NewSessionResponse;
        sessionResponse = created;
        resolvedSessionId = created.sessionId;
        phase('session:new:done');
      } else {
        activeHandlers.set(acpSessionId, () => {});
        try {
          phase('session:load:start');
          sessionResponse = (await ctx.request(methods.agent.session.load, {
            sessionId: acpSessionId,
            cwd,
            mcpServers: [],
          })) as LoadSessionResponse;
          resolvedSessionId = acpSessionId;
          phase('session:load:done');
        } catch (err) {
          console.warn(`[${logTag}] loadSession failed, starting fresh session:`, err);
          activeHandlers.delete(acpSessionId);
          phase('session:new:start');
          const created = (await ctx.request(methods.agent.session.new, {
            cwd,
            mcpServers: [],
          })) as NewSessionResponse;
          sessionResponse = created;
          resolvedSessionId = created.sessionId;
          phase('session:new:done');
        }
        activeHandlers.delete(acpSessionId);
      }

      sessionIdForCancel = resolvedSessionId;

      if (sessionResponse.modes?.currentModeId) {
        resolvedModeId = sessionResponse.modes.currentModeId;
      }

      const modelOption = findConfigOptionByCategory(sessionResponse.configOptions, 'model');
      if (
        modelOption?.type === 'select' &&
        'currentValue' in modelOption &&
        typeof modelOption.currentValue === 'string'
      ) {
        resolvedModelId = modelOption.currentValue;
      }

      console.log(`[${logTag}] session config discovered`, {
        requestedMode: params.mode,
        requestedModel: params.model,
        currentModeId: sessionResponse.modes?.currentModeId,
        availableModes: sessionResponse.modes?.availableModes?.map((m) => m.id),
        configOptions: (sessionResponse.configOptions ?? []).map((o) => ({
          id: o.id,
          category: o.category,
          type: o.type,
          currentValue: 'currentValue' in o ? o.currentValue : undefined,
        })),
      });

      phase('session:config:start');
      await applySessionMode(agent, resolvedSessionId, params.mode, sessionResponse);
      if (!params.skipModelConfigOption) {
        await applySessionModel(agent, resolvedSessionId, params.model, sessionResponse);
      }
      await applySessionConfig(agent, resolvedSessionId, params.configJson, sessionResponse);
      phase('session:config:done');

      const requestedMode = params.mode?.trim();
      const requestedModel = params.model?.trim();
      resolvedModeId = requestedMode && requestedMode !== 'default' ? requestedMode : resolvedModeId;
      resolvedModelId = requestedModel || resolvedModelId;
      emitSessionConfigSync(onEvent, {
        modeId: resolvedModeId,
        modelId: resolvedModelId,
      });

      activeHandlers.set(resolvedSessionId, onEvent);
      try {
        phase('session:prompt:start');
        const resp = (await ctx.request(methods.agent.session.prompt, {
          sessionId: resolvedSessionId,
          prompt: [{ type: 'text', text: promptText }],
        })) as { stopReason?: string };
        phase('session:prompt:done');
        return {
          acpSessionId: resolvedSessionId,
          stopReason: resp.stopReason,
          resolvedModeId,
          resolvedModelId,
        };
      } catch (err) {
        return { acpSessionId: resolvedSessionId, error: String(err), resolvedModeId, resolvedModelId };
      } finally {
        activeHandlers.delete(resolvedSessionId);
        // connectWith waits for the transport to close; close the per-turn subprocess
        // as soon as the ACP prompt request has completed.
        killProc();
      }
    });
  } catch (err) {
    return { acpSessionId: acpSessionId ?? '', error: String(err) };
  } finally {
    activeRuns.delete(novaSessionId);
    configSyncHandlers.delete(novaSessionId);
    killProc();
  }
}

export function cancelAcpSubprocess(novaSessionId: string): void {
  activeRuns.get(novaSessionId)?.cancel();
}

export interface CloseAcpSessionParams {
  command: string;
  args: string[];
  cwd: string;
  acpSessionId: string;
  logTag: string;
}

/** Best-effort ACP session teardown (close, then delete if close unsupported). */
export async function closeAcpSubprocessSession(params: CloseAcpSessionParams): Promise<void> {
  const { command, args, cwd, acpSessionId, logTag } = params;
  const env = { ...process.env, ...config.agentEnv() };

  let proc: ChildProcess;
  try {
    proc = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env });
  } catch {
    return;
  }

  const killProc = () => {
    try {
      proc.kill();
    } catch {
      // already dead
    }
  };

  const stream = ndJsonStream(nodeWritableToWeb(proc.stdin!), nodeReadableToWeb(proc.stdout!));
  const app = buildClientApp();

  try {
    await app.connectWith(stream, async (ctx) => {
      const agent = acpAgent(ctx);
      await ctx.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'nova-code', version: '1.0.0' },
        clientCapabilities: {},
      });
      try {
        await agent.closeSession({ sessionId: acpSessionId });
      } catch (err) {
        console.warn(`[${logTag}] closeSession failed, trying deleteSession:`, err);
        try {
          await agent.deleteSession({ sessionId: acpSessionId });
        } catch (deleteErr) {
          console.warn(`[${logTag}] deleteSession failed:`, deleteErr);
        }
      }
      killProc();
    });
  } catch (err) {
    console.warn(`[${logTag}] closeAcpSubprocessSession failed:`, err);
  } finally {
    killProc();
  }
}
