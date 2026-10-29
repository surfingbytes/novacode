/**
 * Shared subprocess ACP runner using SDK 1.2 ClientApp (replaces ClientSideConnection).
 */

// node_modules
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type {
  ClientContext,
  ContentBlock,
  LoadSessionResponse,
  McpServer,
  NewSessionResponse,
} from '@agentclientprotocol/sdk';

// classes
import { childEnv, childProcessFailure } from './childEnv';
import { config, resolvePromptIdleTimeoutMs } from './config';
import {
  acpAgent,
  applySessionMode,
  applySessionModel,
  applySessionConfig,
  asRecord,
  autoApprovePermission,
  emitSessionConfigSync,
  findConfigOptionByCategory,
  handleSessionNotification,
} from './acpSessionHelpers';
import type {
  AcpEventHandler,
  AcpPermissionHandler,
  AcpSessionResponse,
  SessionConfigSyncHandler,
} from './acpSessionHelpers';
import { defaultAskQuestionResponse, parseAskQuestionParams } from './acpAskQuestion';
import type { AcpAskQuestionHandler, AcpAskQuestionResponse } from './acpAskQuestion';
import { nodeReadableToWeb, nodeWritableToWeb } from './acpStreams';
import { extractAgentErrorDetail, type AgentErrorDetail } from './agentError';
import {
  emitCursorPlanRequest,
  emitCursorTaskActivity,
  isAcpTaskBackgroundLaunch,
  isAcpTaskToolCall,
} from './cursorPlanEvents';
import type { CursorEventHandlerResolver } from './cursorPlanEvents';
import { handleCursorUpdateTodos } from './cursorTodoEvents';
import { logger, truncateLogText } from './logger';
import { getConfiguredAcpMcpServers, mcpUnavailableNoticeEventLine } from './mcpServersForAcp';
import { agentSupportsHttpMcp, novaMcpServerIfSession } from './novaMcp';
import { createSubagentTranscriptWatcher } from './cursorSubagentTranscripts';

// ---- Re-exports (public API kept on this module) ----
export type { AcpEventHandler, AcpPermissionHandler, SessionConfigSyncHandler } from './acpSessionHelpers';
export type { AcpAskQuestionHandler, AcpAskQuestionParams, AcpAskQuestionResponse } from './acpAskQuestion';
export { isAcpTaskToolCall } from './cursorPlanEvents';
export { mergeCursorTodos } from './cursorTodoEvents';

/**
 * An image attachment sent as a native ACP `image` content block. Only image/*
 * MIME types are portable: every ACP agent we integrate advertises `image` and
 * converts it to real model input, while `resource`/blob blocks are ignored or
 * unsupported by several agents — so non-image files must stay path-in-prompt.
 */
export interface AcpPromptAttachment {
  /** MIME type — must be image/*. */
  mimeType: string;
  /** Base64-encoded file contents (the only block form all agents accept). */
  data: string;
  /** Absolute local path — used only to derive the filename for the block's uri. */
  path: string;
}

/** Build the session/prompt content array: text block first, then one image block per attachment. */
export function buildPromptContent(
  promptText: string,
  attachments: AcpPromptAttachment[] = []
): ContentBlock[] {
  const content: ContentBlock[] = [{ type: 'text', text: promptText }];
  for (const attachment of attachments) {
    content.push({
      type: 'image',
      data: attachment.data,
      mimeType: attachment.mimeType,
      uri: pathToFileURL(attachment.path).href,
    });
  }
  return content;
}

export interface AcpSubprocessRunParams {
  command: string;
  args: string[];
  cwd: string;
  novaSessionId: string;
  acpSessionId: string | null;
  promptText: string;
  /** Image attachments sent as native ACP image blocks alongside the text block. */
  attachments?: AcpPromptAttachment[];
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
  /**
   * Last-chance prompt rewrite invoked just before session/prompt, once the
   * ACP session id is known (e.g. agent-specific plan-mode instructions that
   * must embed the session id). Only applied on prompt turns.
   */
  transformPrompt?: (promptText: string, acpSessionId: string) => string;
  /**
   * Lazy builder for the context a new conversation needs (rules, handoff note,
   * linked plan). Invoked only when a FRESH ACP session was created (first
   * turn, or fallback after a failed session/load) — on resumed sessions it is
   * already in the conversation history, so re-sending it would duplicate
   * tokens on every turn. Lazy so resumed turns never hit the disk for it.
   */
  getFreshSessionPrefix?: () => Promise<string>;
  /** Called as soon as the ACP session is opened (before the prompt is sent). */
  onSessionId?: (id: string) => void;
  /**
   * Extra directories the agent may read/write without per-file approval (ACP
   * `additionalDirectories`, e.g. the session's spec folder). Only sent when the
   * agent advertises `sessionCapabilities.additionalDirectories`, or when
   * `additionalDirectoriesUnadvertised` is set for agents known to accept it anyway.
   */
  additionalDirectories?: string[];
  additionalDirectoriesUnadvertised?: boolean;
  /**
   * MCP servers already filtered to reachable ones. Defaults to none — callers
   * that want MCP must probe first. A down server must never be passed here.
   */
  mcpServers?: McpServer[];
  /**
   * Cursor `agent-transcripts` dir for this cwd. Background Task subagents signal
   * completion only there, so without it a background launch settles on `cursor/task`.
   */
  subagentTranscriptsDir?: string;
}

export interface AcpSubprocessRunResult {
  acpSessionId: string;
  stopReason?: string;
  error?: string;
  /** Structured ACP/JSON-RPC fields preserved before the error is stringified. */
  errorDetail?: AgentErrorDetail;
  /** Resolved mode after session create/load when DB had sentinel `default`. */
  resolvedModeId?: string;
  resolvedModelId?: string;
}

interface ActiveRun {
  cancel: () => void;
  /** SIGTERM the subprocess now (SIGKILL after 2 s), without the cancel grace period. */
  kill: () => void;
  acpSessionId: string | null;
}

const activeRuns = new Map<string, ActiveRun>();
const activeHandlers = new Map<string, AcpEventHandler>();
const configSyncHandlers = new Map<string, SessionConfigSyncHandler>();

/** Grace period for the agent to honour session/cancel before the subprocess is killed. */
const CANCEL_GRACE_MS = 3_000;
const SUBAGENT_TRANSCRIPT_POLL_MS = 1_000;
function promptIdleTimeoutMs(): number {
  return resolvePromptIdleTimeoutMs(config.configDir);
}

/**
 * Subagents emit `session/update` (and Cursor `cursor/task`) with their own ACP
 * session id on the same connection. Those must still reach the in-flight prompt
 * handler — otherwise the parent looks idle and the idle timeout kills it.
 */
function resolveEventHandler(
  sessionId: string | null | undefined,
  fallback?: () => AcpEventHandler | undefined
): AcpEventHandler | undefined {
  if (sessionId) {
    const handler = activeHandlers.get(sessionId);
    if (handler) return handler;
  }
  return fallback?.();
}

/** User-visible notice emitted when a failed session/load silently resets the conversation. */
const CONTEXT_RESET_NOTICE_TEXT =
  'Previous conversation context could not be resumed — the agent started a fresh conversation and cannot see earlier messages.';

/** Serialized stream event for the reset notice (persisted in session messages, rendered by the dashboard). */
export function sessionResetNoticeEventLine(): string {
  return JSON.stringify({ type: 'session_reset_notice', text: CONTEXT_RESET_NOTICE_TEXT });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildClientApp(
  onConfigSync?: SessionConfigSyncHandler,
  cursorExtensions?: boolean,
  getActiveSessionId: () => string | null = () => null,
  onRequestPermission: AcpPermissionHandler = autoApprovePermission,
  onAskQuestion?: AcpAskQuestionHandler,
  fallbackEventHandler?: () => AcpEventHandler | undefined
) {
  const resolveCursorHandler: CursorEventHandlerResolver = (sessionId) =>
    resolveEventHandler(sessionId, fallbackEventHandler);
  const app = client({ name: 'nova-code' })
    .onNotification(methods.client.session.update, ({ params }) => {
      const handler = resolveEventHandler(params.sessionId, fallbackEventHandler);
      if (handler) {
        handleSessionNotification(params, handler, onConfigSync);
      }
    })
    .onRequest(methods.client.session.requestPermission, ({ params }) => onRequestPermission(params))
    .onRequest(methods.client.fs.readTextFile, async () => ({ content: '' }))
    .onRequest(methods.client.fs.writeTextFile, async () => ({}));

  if (cursorExtensions) {
    // Cursor ACP extension methods are not in the core ClientRequestMethod union.
    const parseUnknown = (params: unknown): unknown => params;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extApp = app as any;
    extApp
      .onRequest('cursor/ask_question', parseUnknown, async ({ params }: { params: unknown }) => {
        const parsed = parseAskQuestionParams(params);
        if (!parsed) {
          return {
            outcome: { outcome: 'skipped', reason: 'Invalid ask_question request.' },
          } satisfies AcpAskQuestionResponse;
        }
        if (!onAskQuestion) {
          return defaultAskQuestionResponse();
        }
        return onAskQuestion(parsed);
      })
      .onRequest('cursor/create_plan', parseUnknown, async ({ params }: { params: unknown }) => {
        emitCursorPlanRequest(params, getActiveSessionId, resolveCursorHandler);
        return { outcome: { outcome: 'accepted' } };
      })
      .onRequest('cursor/update_todos', parseUnknown, async ({ params }: { params: unknown }) =>
        handleCursorUpdateTodos(params, getActiveSessionId, resolveCursorHandler)
      )
      .onNotification('cursor/update_todos', parseUnknown, ({ params }: { params: unknown }) => {
        handleCursorUpdateTodos(params, getActiveSessionId, resolveCursorHandler);
      })
      .onRequest('cursor/task', parseUnknown, async ({ params }: { params: unknown }) => {
        emitCursorTaskActivity(params, getActiveSessionId, resolveCursorHandler);
        return { outcome: { outcome: 'completed' } };
      })
      .onNotification('cursor/task', parseUnknown, ({ params }: { params: unknown }) => {
        emitCursorTaskActivity(params, getActiveSessionId, resolveCursorHandler);
      })
      .onRequest('cursor/generate_image', parseUnknown, async () => ({
        outcome: { outcome: 'rejected', reason: 'Nova Code does not support image generation yet.' },
      }));
  }

  return app;
}

function createPhaseLogger(logTag: string, novaSessionId: string) {
  let last = Date.now();
  return (phase: string): void => {
    const now = Date.now();
    logger.debug({ logTag, novaSessionId, phase, elapsedMs: now - last }, 'ACP phase');
    last = now;
  };
}

/** Directories to send as ACP `additionalDirectories`, or null when unsupported/empty. */
export function resolveAdditionalDirectories(
  params: Pick<AcpSubprocessRunParams, 'additionalDirectories' | 'additionalDirectoriesUnadvertised'>,
  initialized: unknown
): string[] | null {
  const dirs = params.additionalDirectories?.filter((dir) => dir.trim()) ?? [];
  if (dirs.length === 0) return null;
  const capabilities = (initialized as {
    agentCapabilities?: { sessionCapabilities?: { additionalDirectories?: unknown } | null };
  } | null)?.agentCapabilities?.sessionCapabilities;
  const bAdvertised = capabilities?.additionalDirectories != null;
  return bAdvertised || params.additionalDirectoriesUnadvertised ? dirs : null;
}

export async function runAcpSubprocessPrompt(
  params: AcpSubprocessRunParams,
  onEvent: AcpEventHandler,
  onConfigSync?: SessionConfigSyncHandler,
  onRequestPermission?: AcpPermissionHandler,
  onAskQuestion?: AcpAskQuestionHandler
): Promise<AcpSubprocessRunResult> {
  const { command, args, cwd, novaSessionId, acpSessionId, promptText, logTag } = params;
  const phase = createPhaseLogger(logTag, novaSessionId);

  let proc: ChildProcess;
  let spawnFailure: Promise<never>;
  try {
    proc = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: childEnv() });
    spawnFailure = childProcessFailure(proc);
    phase('spawned');
  } catch (err) {
    const errorDetail = extractAgentErrorDetail(err);
    return { acpSessionId: acpSessionId ?? '', error: errorDetail.message, errorDetail };
  }

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) {
      logger.debug({ logTag, novaSessionId, stderr: truncateLogText(text) }, 'ACP subprocess stderr');
    }
  });

  let ctxRef: ClientContext | null = null;
  let sessionIdForCancel: string | null = acpSessionId;
  let resolvePromptSettled: () => void = () => {};
  const promptSettled = new Promise<void>((resolve) => {
    resolvePromptSettled = resolve;
  });
  let bPromptInFlight = false;
  let bPromptIdleTimedOut = false;
  let promptIdleTimer: ReturnType<typeof setTimeout> | null = null;
  const backgroundTaskIds = new Set<string>();
  /** All Task toolCallIds seen this turn (for total count in the UI). */
  const backgroundTaskIdsSeen = new Set<string>();
  const settledTaskIds = new Set<string>();
  const backgroundTaskLaunchIds = new Set<string>();
  /**
   * Prompts of running Tasks whose transcripts are polled. Foreground Tasks emit nothing
   * over ACP while they work, so transcript growth is their only liveness signal.
   */
  const transcriptPrompts = new Map<string, string>();
  const taskPrompts = new Map<string, string>();
  const transcriptWatcher = params.subagentTranscriptsDir
    ? createSubagentTranscriptWatcher(params.subagentTranscriptsDir, Date.now())
    : null;
  let transcriptPollTimer: ReturnType<typeof setInterval> | null = null;
  let bTranscriptPollBusy = false;
  let resolveBackgroundTasksSettled: (() => void) | null = null;
  let lastEmittedBackgroundRunning = -1;
  let lastEmittedBackgroundTotal = -1;
  const stream = ndJsonStream(nodeWritableToWeb(proc.stdin!), nodeReadableToWeb(proc.stdout!));

  const settleBackgroundTaskWait = (): void => {
    if (backgroundTaskIds.size !== 0 || !resolveBackgroundTasksSettled) return;
    const resolve = resolveBackgroundTasksSettled;
    resolveBackgroundTasksSettled = null;
    resolve();
  };

  const waitForBackgroundTasks = (): Promise<void> => {
    if (backgroundTaskIds.size === 0) return Promise.resolve();
    return new Promise((resolve) => {
      resolveBackgroundTasksSettled = resolve;
    });
  };

  const emitBackgroundTasksProgress = (): void => {
    const running = backgroundTaskIds.size;
    const total = backgroundTaskIdsSeen.size;
    if (running === lastEmittedBackgroundRunning && total === lastEmittedBackgroundTotal) {
      return;
    }
    lastEmittedBackgroundRunning = running;
    lastEmittedBackgroundTotal = total;
    if (total === 0) return;
    onEvent(JSON.stringify({ type: 'background_tasks', running, total }));
  };

  const markBackgroundTaskRunning = (toolCallId: string): void => {
    backgroundTaskIds.add(toolCallId);
    backgroundTaskIdsSeen.add(toolCallId);
    emitBackgroundTasksProgress();
    const prompt = taskPrompts.get(toolCallId);
    if (prompt) watchTaskTranscript(toolCallId, prompt);
  };

  const markBackgroundTaskFinished = (toolCallId: string): void => {
    if (!backgroundTaskIds.has(toolCallId) && !backgroundTaskIdsSeen.has(toolCallId)) {
      return;
    }
    backgroundTaskIdsSeen.add(toolCallId);
    backgroundTaskIds.delete(toolCallId);
    settledTaskIds.add(toolCallId);
    transcriptPrompts.delete(toolCallId);
    emitBackgroundTasksProgress();
    settleBackgroundTaskWait();
  };

  const stopTranscriptPolling = (): void => {
    if (transcriptPollTimer !== null) {
      clearInterval(transcriptPollTimer);
      transcriptPollTimer = null;
    }
  };

  const pollSubagentTranscripts = async (): Promise<void> => {
    if (!transcriptWatcher || bTranscriptPollBusy) return;
    if (transcriptPrompts.size === 0) {
      stopTranscriptPolling();
      return;
    }
    bTranscriptPollBusy = true;
    try {
      const { finished, bActivity } = await transcriptWatcher.poll(transcriptPrompts);
      for (const toolCallId of finished) {
        markBackgroundTaskFinished(toolCallId);
      }
      if (bActivity) armPromptIdleTimer();
    } finally {
      bTranscriptPollBusy = false;
    }
  };

  const watchTaskTranscript = (toolCallId: string, prompt: string): void => {
    if (!transcriptWatcher || settledTaskIds.has(toolCallId)) return;
    transcriptPrompts.set(toolCallId, prompt);
    if (transcriptPollTimer === null) {
      transcriptPollTimer = setInterval(() => void pollSubagentTranscripts(), SUBAGENT_TRANSCRIPT_POLL_MS);
    }
  };

  /**
   * Cursor often finishes the parent turn while Task subagents are still running.
   * ACP may omit rawInput (empty `{}`). A foreground Task's `cursor/task` arrives on
   * completion; a background one (`isBackground`) gets `cursor/task` right at launch
   * and its completion is only visible in the subagent transcript. Neither emits ACP
   * events while working, so the transcript is also what keeps the idle timer alive.
   */
  const trackBackgroundTaskEvent = (line: string): void => {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    if (event.type === 'cursor_task') {
      const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : null;
      if (!toolCallId || settledTaskIds.has(toolCallId)) return;
      if (typeof event.prompt === 'string' && event.prompt.trim()) {
        taskPrompts.set(toolCallId, event.prompt);
      }
      const status = typeof event.status === 'string' ? event.status.toLowerCase() : '';
      if (status === 'in_progress' || status === 'pending' || status === 'running') {
        markBackgroundTaskRunning(toolCallId);
        return;
      }
      if (transcriptWatcher && backgroundTaskLaunchIds.has(toolCallId) && taskPrompts.has(toolCallId)) {
        markBackgroundTaskRunning(toolCallId);
        return;
      }
      markBackgroundTaskFinished(toolCallId);
      return;
    }

    const update =
      event.update && typeof event.update === 'object' && !Array.isArray(event.update)
        ? (event.update as Record<string, unknown>)
        : null;
    const toolCallId = typeof update?.toolCallId === 'string' ? update.toolCallId : null;
    if (!update || !toolCallId) return;

    if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') {
      return;
    }

    const knownTask = backgroundTaskIds.has(toolCallId) || backgroundTaskIdsSeen.has(toolCallId);
    if (!knownTask && !isAcpTaskToolCall(update) && !isAcpTaskBackgroundLaunch(update)) {
      return;
    }
    if (settledTaskIds.has(toolCallId)) return;

    const rawInput = asRecord(update.rawInput);
    if (typeof rawInput?.prompt === 'string' && rawInput.prompt.trim()) {
      taskPrompts.set(toolCallId, rawInput.prompt);
    }
    if (isAcpTaskBackgroundLaunch(update)) {
      backgroundTaskLaunchIds.add(toolCallId);
    }

    const status = typeof update.status === 'string' ? update.status.toLowerCase() : '';
    if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
      markBackgroundTaskFinished(toolCallId);
      return;
    }

    // Keep Task tool calls outstanding through "completed" (launch) until cursor/task.
    markBackgroundTaskRunning(toolCallId);
  };

  const clearPromptIdleTimer = (): void => {
    if (promptIdleTimer !== null) {
      clearTimeout(promptIdleTimer);
      promptIdleTimer = null;
    }
  };

  const armPromptIdleTimer = (): void => {
    const timeoutMs = promptIdleTimeoutMs();
    if (!bPromptInFlight || timeoutMs <= 0) return;
    clearPromptIdleTimer();
    promptIdleTimer = setTimeout(() => {
      bPromptIdleTimedOut = true;
      logger.warn({ logTag, novaSessionId, timeoutMs }, 'prompt idle timeout');
      stopTranscriptPolling();
      backgroundTaskIds.clear();
      settleBackgroundTaskWait();
      killProc();
    }, timeoutMs);
  };

  const handleEvent: AcpEventHandler = (line) => {
    trackBackgroundTaskEvent(line);
    onEvent(line);
    armPromptIdleTimer();
  };

  const app = buildClientApp(
    onConfigSync,
    params.cursorExtensions,
    () => sessionIdForCancel,
    onRequestPermission,
    onAskQuestion,
    () => (bPromptInFlight ? handleEvent : undefined)
  );

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
      stopTranscriptPolling();
      backgroundTaskIds.clear();
      settleBackgroundTaskWait();
      if (ctxRef && sessionIdForCancel) {
        try {
          await ctxRef.notify(methods.agent.session.cancel, { sessionId: sessionIdForCancel });
        } catch {
          // ignore
        }
        // Give the agent a chance to end the turn gracefully (stopReason: 'cancelled')
        // and flush the aborted turn to its session store — a hard kill here can
        // leave the on-disk transcript without the cancelled prompt, so the next
        // session/load would resume a conversation missing the user's message.
        await Promise.race([promptSettled, delay(CANCEL_GRACE_MS)]);
      }
      killProc();
    })();
  };

  activeRuns.set(novaSessionId, {
    cancel: cancelRun,
    kill: killProc,
    get acpSessionId() {
      return sessionIdForCancel;
    },
  });

  if (onConfigSync) {
    configSyncHandlers.set(novaSessionId, onConfigSync);
  }

  try {
    return await Promise.race([spawnFailure, app.connectWith(stream, async (ctx) => {
      ctxRef = ctx;
      const agent = acpAgent(ctx);

      phase('initialize:start');
      const initialized = await ctx.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'nova-code', version: '1.0.0' },
        clientCapabilities: params.cursorExtensions
          ? { fs: { readTextFile: false, writeTextFile: false }, terminal: false }
          : { session: { configOptions: { boolean: true } } },
      });
      phase('initialize:done');

      const extraDirs = resolveAdditionalDirectories(params, initialized);

      let resolvedModeId: string | undefined;
      let resolvedModelId: string | undefined;
      // Explicit `mcpServers` (probes, one-shots) are used as-is; chat turns get the
      // configured servers plus Nova's own MCP for this session.
      let mcpServers = params.mcpServers ?? await getConfiguredAcpMcpServers(config.configDir);
      if (!params.mcpServers) {
        const nova = await novaMcpServerIfSession(novaSessionId, agentSupportsHttpMcp(initialized));
        if (nova) mcpServers = [...mcpServers.filter((server) => server.name !== nova.name), nova];
      }

      const newSession = async (servers: McpServer[]): Promise<NewSessionResponse> => {
        phase('session:new:start');
        const created = (await ctx.request(methods.agent.session.new, {
          cwd,
          mcpServers: servers,
          ...(extraDirs ? { additionalDirectories: extraDirs } : {}),
        })) as NewSessionResponse;
        phase('session:new:done');
        return created;
      };

      const loadOrCreateSession = async (servers: McpServer[]): Promise<{
        sessionId: string;
        response: AcpSessionResponse;
        /** True when a brand-new conversation was created (new-conversation context must be injected). */
        isFresh: boolean;
      }> => {
        if (!acpSessionId) {
          const created = await newSession(servers);
          return { sessionId: created.sessionId, response: created, isFresh: true };
        }
        activeHandlers.set(acpSessionId, () => {});
        try {
          phase('session:load:start');
          const loaded = (await ctx.request(methods.agent.session.load, {
            sessionId: acpSessionId,
            cwd,
            mcpServers: servers,
            ...(extraDirs ? { additionalDirectories: extraDirs } : {}),
          })) as LoadSessionResponse;
          phase('session:load:done');
          return { sessionId: acpSessionId, response: loaded, isFresh: false };
        } catch (err) {
          logger.warn({ logTag, novaSessionId, err }, 'loadSession failed, starting fresh session');
          handleEvent(sessionResetNoticeEventLine());
          activeHandlers.delete(acpSessionId);
          const created = await newSession(servers);
          return { sessionId: created.sessionId, response: created, isFresh: true };
        } finally {
          activeHandlers.delete(acpSessionId);
        }
      };

      let opened: { sessionId: string; response: AcpSessionResponse; isFresh: boolean };
      try {
        opened = await loadOrCreateSession(mcpServers);
      } catch (err) {
        if (mcpServers.length === 0) {
          throw err;
        }
        logger.warn(
          { logTag, novaSessionId, err, mcpCount: mcpServers.length },
          'ACP session failed with MCP servers; retrying without them'
        );
        const notice = mcpUnavailableNoticeEventLine(
          mcpServers.map((server) => ({
            name: server.name,
            error: 'agent rejected MCP during session setup'
          }))
        );
        if (notice) handleEvent(notice);
        opened = await loadOrCreateSession([]);
      }

      const sessionResponse = opened.response;
      const resolvedSessionId = opened.sessionId;

      sessionIdForCancel = resolvedSessionId;
      params.onSessionId?.(resolvedSessionId);

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

      logger.debug(
        {
          logTag,
          novaSessionId,
          requestedMode: params.mode,
          requestedModel: params.model,
          currentModeId: sessionResponse.modes?.currentModeId,
          availableModeCount: sessionResponse.modes?.availableModes?.length ?? 0,
          configOptionCount: sessionResponse.configOptions?.length ?? 0
        },
        'session config discovered'
      );

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
      emitSessionConfigSync(handleEvent, {
        modeId: resolvedModeId,
        modelId: resolvedModelId,
      });

      activeHandlers.set(resolvedSessionId, handleEvent);
      try {
        phase('session:prompt:start');
        let basePromptText = promptText;
        if (opened.isFresh && params.getFreshSessionPrefix) {
          try {
            const freshPrefix = await params.getFreshSessionPrefix();
            if (freshPrefix.trim()) {
              basePromptText = `${freshPrefix}\n\n---\n\nUser request:\n${promptText}`;
            }
          } catch (err) {
            logger.warn({ logTag, novaSessionId, err }, 'Failed to build fresh-session prefix; prompting without it');
          }
        }
        const finalPromptText = params.transformPrompt
          ? params.transformPrompt(basePromptText, resolvedSessionId)
          : basePromptText;
        bPromptInFlight = true;
        armPromptIdleTimer();
        const resp = (await ctx.request(methods.agent.session.prompt, {
          sessionId: resolvedSessionId,
          prompt: buildPromptContent(finalPromptText, params.attachments),
        })) as { stopReason?: string };
        // The SDK resolves responses synchronously but dispatches notifications through an
        // async handler chain; let notifications received before the response finish first.
        await new Promise((resolve) => setImmediate(resolve));
        phase('session:prompt:done');
        if (backgroundTaskIds.size > 0) {
          logger.debug(
            { logTag, novaSessionId, backgroundTaskCount: backgroundTaskIds.size },
            'parent prompt finished; waiting for background subagents'
          );
          await waitForBackgroundTasks();
          if (bPromptIdleTimedOut) {
            return {
              acpSessionId: resolvedSessionId,
              error: `Agent produced no output for ${Math.round(promptIdleTimeoutMs() / 1000)}s and was stopped.`,
              resolvedModeId,
              resolvedModelId,
            };
          }
          phase('background-tasks:done');
        }
        return {
          acpSessionId: resolvedSessionId,
          stopReason: resp.stopReason,
          resolvedModeId,
          resolvedModelId,
        };
      } catch (err) {
        if (bPromptIdleTimedOut) {
          return {
            acpSessionId: resolvedSessionId,
            error: `Agent produced no output for ${Math.round(promptIdleTimeoutMs() / 1000)}s and was stopped.`,
            resolvedModeId,
            resolvedModelId,
          };
        }
        const errorDetail = extractAgentErrorDetail(err);
        return {
          acpSessionId: resolvedSessionId,
          error: errorDetail.message,
          errorDetail,
          resolvedModeId,
          resolvedModelId,
        };
      } finally {
        bPromptInFlight = false;
        clearPromptIdleTimer();
        stopTranscriptPolling();
        resolvePromptSettled();
        activeHandlers.delete(resolvedSessionId);
        // connectWith waits for the transport to close; close the per-turn subprocess
        // as soon as the ACP prompt request has completed.
        killProc();
      }
    })]);
  } catch (err) {
    resolvePromptSettled();
    clearPromptIdleTimer();
    if (bPromptIdleTimedOut) {
      return {
        acpSessionId: sessionIdForCancel ?? '',
        error: `Agent produced no output for ${Math.round(promptIdleTimeoutMs() / 1000)}s and was stopped.`,
      };
    }
    // Preserve the ACP session id resolved this turn (session/new or session/load):
    // when a cancel kills the subprocess mid-prompt, connectWith rejects even though
    // the id is known — returning '' here would drop it, and the next prompt would
    // start a fresh agent conversation that cannot see this turn's messages.
    const errorDetail = extractAgentErrorDetail(err);
    return { acpSessionId: sessionIdForCancel ?? '', error: errorDetail.message, errorDetail };
  } finally {
    clearPromptIdleTimer();
    stopTranscriptPolling();
    activeRuns.delete(novaSessionId);
    configSyncHandlers.delete(novaSessionId);
    killProc();
  }
}

export function cancelAcpSubprocess(novaSessionId: string): void {
  activeRuns.get(novaSessionId)?.cancel();
}

/** Kill every ACP subprocess still running a prompt (server shutdown); returns how many. */
export function killAllAcpSubprocesses(): number {
  const runs = [...activeRuns.values()];
  for (const run of runs) run.kill();
  return runs.length;
}

export interface CloseAcpSessionParams {
  command: string;
  args: string[];
  cwd: string;
  acpSessionId: string;
  logTag: string;
  /** Overall deadline; defaults to `CLOSE_ACP_SESSION_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** SIGTERM → SIGKILL grace after the deadline; defaults to `CLOSE_ACP_SESSION_KILL_GRACE_MS`. */
  killGraceMs?: number;
}

const CLOSE_ACP_SESSION_TIMEOUT_MS = 10_000;
const CLOSE_ACP_SESSION_KILL_GRACE_MS = 2_000;

/**
 * Best-effort ACP session teardown (close, then delete if close unsupported). Never rejects:
 * after `timeoutMs` the subprocess gets SIGTERM (SIGKILL after `killGraceMs`) and this resolves.
 */
export async function closeAcpSubprocessSession(params: CloseAcpSessionParams): Promise<void> {
  const {
    command,
    args,
    cwd,
    acpSessionId,
    logTag,
    timeoutMs = CLOSE_ACP_SESSION_TIMEOUT_MS,
    killGraceMs = CLOSE_ACP_SESSION_KILL_GRACE_MS
  } = params;
  let proc: ChildProcess;
  let spawnFailure: Promise<never>;
  try {
    proc = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: childEnv() });
    spawnFailure = childProcessFailure(proc);
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

  let deadlineTimer: NodeJS.Timeout | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    deadlineTimer = setTimeout(() => resolve('timeout'), timeoutMs);
  });

  const stream = ndJsonStream(nodeWritableToWeb(proc.stdin!), nodeReadableToWeb(proc.stdout!));
  const app = buildClientApp();

  try {
    const outcome = await Promise.race([deadline, spawnFailure, app.connectWith(stream, async (ctx) => {
      const agent = acpAgent(ctx);
      await ctx.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'nova-code', version: '1.0.0' },
        clientCapabilities: {},
      });
      try {
        await agent.closeSession({ sessionId: acpSessionId });
      } catch (err) {
        logger.debug({ logTag, err }, 'closeSession failed, trying deleteSession');
        try {
          await agent.deleteSession({ sessionId: acpSessionId });
        } catch (deleteErr) {
          logger.debug({ logTag, err: deleteErr }, 'deleteSession failed');
        }
      }
      killProc();
    })]);
    if (outcome === 'timeout') {
      logger.warn({ logTag, timeoutMs }, 'closeAcpSubprocessSession timed out; killing subprocess');
      killProc();
      const killTimer = setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) {
          try {
            proc.kill('SIGKILL');
          } catch {
            // already dead
          }
        }
      }, killGraceMs);
      killTimer.unref();
    }
  } catch (err) {
    logger.warn({ logTag, err }, 'closeAcpSubprocessSession failed');
  } finally {
    clearTimeout(deadlineTimer);
    killProc();
  }
}
