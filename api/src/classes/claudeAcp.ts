// node_modules
// @agentclientprotocol/claude-agent-acp is ESM-only. TypeScript (module: commonjs) compiles
// import() → require(), which fails for ESM packages. We use a new Function('m','return import(m)')
// wrapper so the import stays as a true ESM dynamic import at runtime. Types are import-type only.
import type { ClaudeAcpAgent } from '@agentclientprotocol/claude-agent-acp';
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type {
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk';

// classes
import { applySessionMode, applySessionModel, applySessionConfig } from './acpSessionHelpers';
import type { AcpSessionResponse } from './acpSessionHelpers';
import { extractAgentErrorDetail } from './agentError';
import type { AgentErrorDetail } from './agentError';
import { logger } from './logger';
import { config, resolveClaudeAgentIdleTimeoutMs, resolvePromptIdleTimeoutMs } from './config';
import { getConfiguredAcpMcpServers } from './mcpServersForAcp';
import { novaMcpServerIfSession } from './novaMcp';
import { buildPromptContent, sessionResetNoticeEventLine } from './acpSubprocessRunner';
import type { AcpPermissionHandler, AcpPromptAttachment, SessionConfigSyncHandler } from './acpSubprocessRunner';

/** Client callbacks the embedded ClaudeAcpAgent invokes (SDK 2.0 removed AgentSideConnection). */
export type ClaudeAcpClient = ConstructorParameters<typeof ClaudeAcpAgent>[0];

export type AcpEventHandler = (line: string) => void;
// Re-used by any ACP agent added later (Mistral, etc.).

// Routes streaming notifications per ACP session ID to the active prompt's handler.
const activeHandlers = new Map<string, AcpEventHandler>();
const activeConfigSyncHandlers = new Map<string, SessionConfigSyncHandler>();
const activePermissionHandlers = new Map<string, AcpPermissionHandler>();

// --------------------------------------------- Follow-up work tracking ---------------------------------------------
//
// Claude Code keeps working after a prompt's result: background Bash commands and
// subagents run on, and when one finishes it starts a model cycle on its own (the
// `task-notification` follow-up) that streams its output outside any prompt. The
// adapter reports that work through its `foreground` constructor option and, with
// `emitRawSDKMessages`, the SDK's background task level signal. A turn stays open
// until that work drains so the follow-up lands in the same assistant message
// instead of being dropped.

/** How long a turn waits, after the last sign of follow-up work, before ending. */
const FOLLOWUP_GRACE_MS = 2_000;
/** Upper bound on waiting for a task-notification follow-up to start streaming. */
const FOLLOWUP_START_TIMEOUT_MS = 120_000;

/** Session creation `_meta`: the raw SDK messages Nova needs to see follow-up work. */
const CLAUDE_SESSION_META = {
  claudeCode: {
    emitRawSDKMessages: [
      { type: 'system', subtype: 'background_tasks_changed' },
      { type: 'user', origin: 'task-notification' },
      { type: 'result' },
    ],
  },
};

interface SessionWork {
  /** The adapter reports a turn or a self-started cycle running. */
  foreground: boolean;
  /** A task-notification follow-up was queued and has not produced output or a result yet. */
  followupPendingSince: number | null;
  /** Live background tasks (shells, subagents) from the SDK level signal, ambient ones excluded. */
  liveTaskIds: Set<string>;
  /** Every live task seen since the current turn started, for the running/total badge. */
  seenTaskIds: Set<string>;
  /** Stop reason of the last foreground work that ended. */
  lastStopReason: string | undefined;
  /** Set by cancel / dispose: a held turn ends at once. */
  released: boolean;
  waiters: Set<() => void>;
}

const workByAcpSession = new Map<string, SessionWork>();

function getSessionWork(acpSessionId: string): SessionWork {
  let work = workByAcpSession.get(acpSessionId);
  if (!work) {
    work = {
      foreground: false,
      followupPendingSince: null,
      liveTaskIds: new Set(),
      seenTaskIds: new Set(),
      lastStopReason: undefined,
      released: false,
      waiters: new Set(),
    };
    workByAcpSession.set(acpSessionId, work);
  }
  return work;
}

function wakeSessionWork(work: SessionWork): void {
  const waiters = [...work.waiters];
  work.waiters.clear();
  for (const wake of waiters) wake();
}

/** Whether Claude Code still has follow-up work in flight for this ACP session. */
function hasFollowupWork(work: SessionWork): boolean {
  if (work.released) return false;
  if (work.foreground || work.liveTaskIds.size > 0) return true;
  return (
    work.followupPendingSince !== null &&
    Date.now() - work.followupPendingSince < FOLLOWUP_START_TIMEOUT_MS
  );
}

/** End any held turn for the session (cancel / dispose). */
function releaseSessionWork(acpSessionId: string): void {
  const work = workByAcpSession.get(acpSessionId);
  if (!work) return;
  work.released = true;
  wakeSessionWork(work);
}

function emitBackgroundTaskCounts(acpSessionId: string, work: SessionWork): void {
  const handler = activeHandlers.get(acpSessionId);
  if (!handler || work.seenTaskIds.size === 0) return;
  handler(
    JSON.stringify({ type: 'background_tasks', running: work.liveTaskIds.size, total: work.seenTaskIds.size })
  );
}

function makeForegroundEvents(acpSessionId: string): {
  running: () => void;
  awaitingUser: () => void;
  ended: (outcome: { stopReason?: string }) => void;
  failed: (error: unknown) => void;
} {
  const setForeground = (foreground: boolean, stopReason?: string): void => {
    const work = getSessionWork(acpSessionId);
    work.foreground = foreground;
    if (foreground) work.followupPendingSince = null;
    if (stopReason) work.lastStopReason = stopReason;
    wakeSessionWork(work);
  };
  return {
    running: () => setForeground(true),
    awaitingUser: () => {},
    ended: (outcome) => setForeground(false, outcome?.stopReason),
    failed: () => setForeground(false),
  };
}

/** Raw SDK messages (`_claude/sdkMessage`) that describe follow-up work. */
function trackRawSdkMessage(acpSessionId: string, message: Record<string, unknown>): void {
  const work = getSessionWork(acpSessionId);
  if (message.type === 'system' && message.subtype === 'background_tasks_changed') {
    const tasks = Array.isArray(message.tasks) ? (message.tasks as Array<Record<string, unknown>>) : [];
    work.liveTaskIds = new Set(
      tasks
        .filter((task) => task.ambient !== true && typeof task.task_id === 'string')
        .map((task) => task.task_id as string)
    );
    for (const id of work.liveTaskIds) work.seenTaskIds.add(id);
    emitBackgroundTaskCounts(acpSessionId, work);
    wakeSessionWork(work);
    return;
  }
  if (message.type === 'user') {
    const origin = message.origin as { kind?: string; subkind?: string } | undefined;
    if (origin?.kind === 'task-notification' && !work.foreground) {
      work.followupPendingSince = Date.now();
      wakeSessionWork(work);
    }
    return;
  }
  if (message.type === 'result') {
    work.followupPendingSince = null;
    wakeSessionWork(work);
  }
}

// One ClaudeAcpAgent per Nova session so parallel chats cannot share query/task
// state inside a singleton agent (which previously made two sessions feel like one).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const agentsByNovaSession = new Map<string, any>();
const novaByAcpSession = new Map<string, string>();
const initializedNovaSessions = new Set<string>();

// Each cached agent keeps a live `claude` CLI (plus one connection / child process per
// configured MCP server) after its turn ends. Idle agents are disposed by a periodic
// sweep and an LRU cap; the next turn resumes the conversation from disk.
const MAX_LIVE_CLAUDE_AGENTS = 10;
const IDLE_SWEEP_INTERVAL_MS = 60_000;
const lastUsedByNovaSession = new Map<string, number>();
const inFlightTurnsByNovaSession = new Map<string, number>();
let idleSweepTimer: ReturnType<typeof setInterval> | null = null;

function forgetNovaSession(novaSessionId: string): void {
  agentsByNovaSession.delete(novaSessionId);
  initializedNovaSessions.delete(novaSessionId);
  lastUsedByNovaSession.delete(novaSessionId);
  for (const [acpId, novaId] of novaByAcpSession.entries()) {
    if (novaId === novaSessionId) {
      novaByAcpSession.delete(acpId);
      // The CLI is going away: nothing will report its background work ending.
      releaseSessionWork(acpId);
      workByAcpSession.delete(acpId);
    }
  }
}

/**
 * Release the agent's CLI subprocess and MCP connections. Uses dispose() (in-memory
 * teardown only) — closeSession/deleteSession may delete the on-disk transcript.
 */
async function disposeAgent(novaSessionId: string, reason: string): Promise<void> {
  const agent = agentsByNovaSession.get(novaSessionId);
  forgetNovaSession(novaSessionId);
  if (!agent) return;
  logger.info({ novaSessionId, reason }, 'Disposing embedded Claude agent');
  try {
    await agent.dispose?.();
  } catch (err) {
    logger.debug({ err, novaSessionId }, 'Claude ACP dispose failed');
  }
}

function isTurnInFlight(novaSessionId: string): boolean {
  return (inFlightTurnsByNovaSession.get(novaSessionId) ?? 0) > 0;
}

function idleAgentsOldestFirst(): Array<[string, number]> {
  return [...agentsByNovaSession.keys()]
    .filter((id) => !isTurnInFlight(id))
    .map((id): [string, number] => [id, lastUsedByNovaSession.get(id) ?? 0])
    .sort((a, b) => a[1] - b[1]);
}

function sweepIdleAgents(): void {
  const idleTimeoutMs = resolveClaudeAgentIdleTimeoutMs(config.configDir);
  if (idleTimeoutMs <= 0) return;
  const cutoff = Date.now() - idleTimeoutMs;
  for (const [novaSessionId, lastUsed] of idleAgentsOldestFirst()) {
    if (lastUsed > cutoff) break;
    void disposeAgent(novaSessionId, 'idle');
  }
}

function enforceAgentCap(): void {
  let excess = agentsByNovaSession.size - MAX_LIVE_CLAUDE_AGENTS;
  for (const [novaSessionId] of idleAgentsOldestFirst()) {
    if (excess <= 0) break;
    void disposeAgent(novaSessionId, 'cap');
    excess--;
  }
}

function ensureIdleSweep(): void {
  if (idleSweepTimer) return;
  idleSweepTimer = setInterval(sweepIdleAgents, IDLE_SWEEP_INTERVAL_MS);
  idleSweepTimer.unref();
}

function emitClaudeConfigSync(
  sessionId: string,
  sync: { modeId?: string; modelId?: string; config?: Record<string, string> }
): void {
  const handler = activeHandlers.get(sessionId);
  const syncHandler = activeConfigSyncHandlers.get(sessionId);
  if (syncHandler) syncHandler(sync);
  if (handler && (sync.modeId || sync.modelId || sync.config)) {
    handler(JSON.stringify({ type: 'session_config_sync', ...sync }));
  }
}

function extractClaudeConfigSync(
  update: SessionNotification['update'],
  sessionId: string
): void {
  if (update.sessionUpdate === 'current_mode_update') {
    emitClaudeConfigSync(sessionId, { modeId: update.currentModeId });
    return;
  }
  if (update.sessionUpdate === 'config_option_update') {
    const modelOpt = update.configOptions.find((o) => o.category === 'model' || o.id === 'model');
    const sync: { modelId?: string; config?: Record<string, string> } = {};
    if (modelOpt?.type === 'select' && 'currentValue' in modelOpt && typeof modelOpt.currentValue === 'string') {
      sync.modelId = modelOpt.currentValue;
    }
    const configOptions: Record<string, string> = {};
    for (const opt of update.configOptions) {
      if (opt.type !== 'select') continue;
      const cat = opt.category ?? opt.id;
      if (cat === 'mode' || cat === 'model' || opt.id === 'mode' || opt.id === 'model') continue;
      if ('currentValue' in opt && typeof opt.currentValue === 'string') {
        configOptions[opt.id] = opt.currentValue;
      }
    }
    if (Object.keys(configOptions).length > 0) sync.config = configOptions;
    if (sync.modelId || sync.config) emitClaudeConfigSync(sessionId, sync);
  }
}

// Auto-approve all tool permissions when no turn handler is registered —
// agent runs in a trusted backend context. Active turns use chatEngine policy.
async function handlePermissionRequest(
  params: RequestPermissionRequest
): Promise<RequestPermissionResponse> {
  const activeHandler = activePermissionHandlers.get(params.sessionId);
  if (activeHandler) {
    return activeHandler(params);
  }
  const allowOption = params.options.find(
    (o) => o.kind === 'allow_once' || o.kind === 'allow_always'
  );
  if (allowOption) {
    return { outcome: { outcome: 'selected', optionId: allowOption.optionId } };
  }
  return { outcome: { outcome: 'cancelled' } };
}

// Duck-typed ACP client proxy satisfying the ClaudeAcpClient interface at runtime.
// Notifications are forwarded as raw JSON — the frontend parses them natively.
const acpClientProxy = {
  sessionUpdate: async (notification: SessionNotification): Promise<void> => {
    extractClaudeConfigSync(notification.update, notification.sessionId);
    const handler = activeHandlers.get(notification.sessionId);
    if (handler) {
      handler(JSON.stringify(notification));
    }
  },
  requestPermission: handlePermissionRequest,
  readTextFile: async (_params: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
    return { content: '' };
  },
  writeTextFile: async (_params: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
    return {};
  },
  // Claude ACP ≥0.84 sends `_auth/status_update` (and similar) via extNotification;
  // unknown methods are meant to be dropped silently by clients. `_claude/sdkMessage`
  // carries the raw SDK messages requested in CLAUDE_SESSION_META.
  extNotification: async (method: string, params: Record<string, unknown>): Promise<void> => {
    if (method !== '_claude/sdkMessage') return;
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
    const message =
      params.message && typeof params.message === 'object' ? (params.message as Record<string, unknown>) : null;
    if (sessionId && message) trackRawSdkMessage(sessionId, message);
  },
} satisfies Partial<ClaudeAcpClient>;

// --------------------------------------------- Claude-specific agent ---------------------------------------------

// new Function wrapper prevents TypeScript (module: commonjs) from compiling import() → require().
// At runtime this stays as a true ESM dynamic import, which can load ESM-only packages.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const esmImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;

/** `ClaudeAcpAgent` constructor: client, optional logger, optional options (`foreground` reporter). */
type ClaudeAcpAgentCtorType = new (
  client: ClaudeAcpClient,
  logger?: unknown,
  options?: { foreground?: (sessionId: string) => ReturnType<typeof makeForegroundEvents> }
) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

let ClaudeAcpAgentCtor: ClaudeAcpAgentCtorType | null = null;

async function loadClaudeAcpAgentCtor(): Promise<ClaudeAcpAgentCtorType> {
  if (!ClaudeAcpAgentCtor) {
    const mod = await esmImport('@agentclientprotocol/claude-agent-acp');
    ClaudeAcpAgentCtor = mod.ClaudeAcpAgent;
  }
  return ClaudeAcpAgentCtor!;
}

/** Test hook: substitute a fake ClaudeAcpAgent class (skips the ESM import). */
export function setClaudeAcpAgentCtorForTests(ctor: ClaudeAcpAgentCtorType): void {
  ClaudeAcpAgentCtor = ctor;
}

async function getAgentForNovaSession(novaSessionId: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  let agent = agentsByNovaSession.get(novaSessionId);
  if (!agent) {
    const Ctor = await loadClaudeAcpAgentCtor();
    agent = new Ctor(acpClientProxy as unknown as ClaudeAcpClient, undefined, {
      foreground: makeForegroundEvents,
    });
    agentsByNovaSession.set(novaSessionId, agent);
    ensureIdleSweep();
    enforceAgentCap();
  }
  if (!initializedNovaSessions.has(novaSessionId)) {
    await agent.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'nova-code', version: '1.0.0' },
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    });
    initializedNovaSessions.add(novaSessionId);
  }
  return agent;
}

function rememberAcpBinding(novaSessionId: string, acpSessionId: string): void {
  const previousNova = novaByAcpSession.get(acpSessionId);
  if (previousNova && previousNova !== novaSessionId) {
    logger.warn(
      { acpSessionId, previousNova, novaSessionId },
      'Claude ACP session id rebound to a different Nova session'
    );
  }
  novaByAcpSession.set(acpSessionId, novaSessionId);
}

function findAgentForAcpSession(acpSessionId: string): any | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  const novaSessionId = novaByAcpSession.get(acpSessionId);
  if (novaSessionId) {
    return agentsByNovaSession.get(novaSessionId) ?? null;
  }
  // Fallback scan — bindings are set before prompt, but cancel during startup
  // may race ahead of rememberAcpBinding.
  for (const agent of agentsByNovaSession.values()) {
    if (agent?.sessions?.[acpSessionId]) return agent;
  }
  return null;
}

// --------------------------------------------- Public API ---------------------------------------------

export interface RunClaudeAcpParams {
  /** Nova session id — isolates the embedded Claude agent instance. */
  novaSessionId: string;
  /** ACP session ID from a previous run — null to start a new session. */
  acpSessionId: string | null;
  cwd: string;
  promptText: string;
  /** Image attachments sent as native ACP image blocks (Claude converts them to Anthropic image parts). */
  attachments?: AcpPromptAttachment[];
  /** Optional OAuth token forwarded as CLAUDE_CODE_OAUTH_TOKEN. */
  claudeToken?: string | null;
  model?: string;
  mode?: string;
  configJson?: Record<string, string>;
  /**
   * Lazy rules-prefix builder, invoked only when a FRESH ACP session was
   * created — on resumed sessions the rules are already in history, so
   * re-sending them would duplicate tokens on every turn.
   */
  getRulesPrefix?: () => Promise<string>;
  /** Extra dirs the agent may use without per-file approval (ACP additionalDirectories). */
  additionalDirectories?: string[];
  /** Called with the resolved session ID before the prompt starts — used to keep cancel state in sync. */
  onSessionId?: (id: string) => void;
}

export interface RunClaudeAcpResult {
  /** ACP session ID — persist in the DB for conversation continuity. */
  acpSessionId: string;
  stopReason?: string;
  error?: string;
  errorDetail?: AgentErrorDetail;
}

export async function runClaudeAcp(
  params: RunClaudeAcpParams,
  onEvent: AcpEventHandler,
  onConfigSync?: SessionConfigSyncHandler,
  onRequestPermission?: AcpPermissionHandler
): Promise<RunClaudeAcpResult> {
  const { novaSessionId } = params;
  // marked before any await so the idle sweep / cap never disposes a starting turn
  inFlightTurnsByNovaSession.set(novaSessionId, (inFlightTurnsByNovaSession.get(novaSessionId) ?? 0) + 1);
  try {
    return await runClaudeAcpTurn(params, onEvent, onConfigSync, onRequestPermission);
  } finally {
    const remaining = (inFlightTurnsByNovaSession.get(novaSessionId) ?? 1) - 1;
    if (remaining > 0) inFlightTurnsByNovaSession.set(novaSessionId, remaining);
    else inFlightTurnsByNovaSession.delete(novaSessionId);
    if (agentsByNovaSession.has(novaSessionId)) lastUsedByNovaSession.set(novaSessionId, Date.now());
  }
}

async function runClaudeAcpTurn(
  params: RunClaudeAcpParams,
  onEvent: AcpEventHandler,
  onConfigSync?: SessionConfigSyncHandler,
  onRequestPermission?: AcpPermissionHandler
): Promise<RunClaudeAcpResult> {
  const {
    novaSessionId,
    acpSessionId,
    cwd,
    promptText,
    claudeToken,
    model,
    mode,
    configJson,
    onSessionId,
  } = params;
  const extraDirs = params.additionalDirectories?.length
    ? { additionalDirectories: params.additionalDirectories }
    : {};

  if (claudeToken) {
    process.env['CLAUDE_CODE_OAUTH_TOKEN'] = claudeToken;
  }

  const agent = await getAgentForNovaSession(novaSessionId);
  // claude-agent-acp supports HTTP MCP; Nova's server is skipped for one-shot runs (no DB session).
  const configuredMcp = await getConfiguredAcpMcpServers(config.configDir);
  const novaMcp = await novaMcpServerIfSession(novaSessionId, true);
  const mcpServers = novaMcp
    ? [...configuredMcp.filter((server) => server.name !== novaMcp.name), novaMcp]
    : configuredMcp;
  let resolvedSessionId: string;
  let sessionResponse: AcpSessionResponse;
  /** True when a brand-new conversation was created (rules must be injected). */
  let isFreshSession = false;

  const sessionParams = { cwd, mcpServers, _meta: CLAUDE_SESSION_META, ...extraDirs };
  if (!acpSessionId) {
    const created = await agent.newSession(sessionParams);
    sessionResponse = created;
    resolvedSessionId = created.sessionId;
    isFreshSession = true;
  } else {
    try {
      sessionResponse = await agent.resumeSession({ sessionId: acpSessionId, ...sessionParams });
      resolvedSessionId = acpSessionId;
    } catch {
      onEvent(sessionResetNoticeEventLine());
      const created = await agent.newSession(sessionParams);
      sessionResponse = created;
      resolvedSessionId = created.sessionId;
      isFreshSession = true;
    }
  }

  rememberAcpBinding(novaSessionId, resolvedSessionId);

  await applySessionMode(agent, resolvedSessionId, mode, sessionResponse);
  await applySessionModel(agent, resolvedSessionId, model, sessionResponse);
  await applySessionConfig(agent, resolvedSessionId, configJson, sessionResponse);

  const resolvedModeId = sessionResponse.modes?.currentModeId;
  const modelOpt = sessionResponse.configOptions?.find(
    (o) => o.category === 'model' || o.id === 'model'
  );
  const resolvedModelId =
    modelOpt?.type === 'select' &&
    'currentValue' in modelOpt &&
    typeof modelOpt.currentValue === 'string'
      ? modelOpt.currentValue
      : undefined;
  if (resolvedModeId || resolvedModelId || model) {
    emitClaudeConfigSync(resolvedSessionId, { modeId: resolvedModeId, modelId: model ?? resolvedModelId });
  }

  // No-output watchdog (same setting as subprocess agents). Paused while a permission
  // prompt waits on the user. Disposing the agent tears down the CLI, which makes the
  // pending prompt() settle.
  let bPromptIdleTimedOut = false;
  let promptIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingPermissions = 0;
  const clearPromptIdleTimer = (): void => {
    if (promptIdleTimer !== null) {
      clearTimeout(promptIdleTimer);
      promptIdleTimer = null;
    }
  };
  const armPromptIdleTimer = (): void => {
    clearPromptIdleTimer();
    const timeoutMs = resolvePromptIdleTimeoutMs(config.configDir);
    if (timeoutMs <= 0 || pendingPermissions > 0) return;
    promptIdleTimer = setTimeout(() => {
      bPromptIdleTimedOut = true;
      logger.warn({ novaSessionId, timeoutMs }, 'Claude prompt idle timeout');
      void disposeAgent(novaSessionId, 'prompt idle timeout');
    }, timeoutMs);
  };
  const handleEvent: AcpEventHandler = (line) => {
    armPromptIdleTimer();
    onEvent(line);
  };
  const handlePermission: AcpPermissionHandler | undefined = onRequestPermission
    ? async (request) => {
        pendingPermissions++;
        clearPromptIdleTimer();
        try {
          return await onRequestPermission(request);
        } finally {
          pendingPermissions--;
          armPromptIdleTimer();
        }
      }
    : undefined;

  onSessionId?.(resolvedSessionId);
  activeHandlers.set(resolvedSessionId, handleEvent);
  if (onConfigSync) activeConfigSyncHandlers.set(resolvedSessionId, onConfigSync);
  if (handlePermission) activePermissionHandlers.set(resolvedSessionId, handlePermission);
  const idleTimeoutError = (): RunClaudeAcpResult => ({
    acpSessionId: resolvedSessionId,
    error: `Agent produced no output for ${Math.round(resolvePromptIdleTimeoutMs(config.configDir) / 1000)}s and was stopped.`,
  });
  try {
    let finalPromptText = promptText;
    if (isFreshSession && params.getRulesPrefix) {
      try {
        const rulesPrefix = await params.getRulesPrefix();
        if (rulesPrefix.trim()) {
          finalPromptText = `${rulesPrefix}\n\n---\n\nUser request:\n${promptText}`;
        }
      } catch (err) {
        logger.warn({ err, sessionId: resolvedSessionId }, 'Failed to build rules prefix; prompting without rules');
      }
    }
    const work = getSessionWork(resolvedSessionId);
    work.released = false;
    work.lastStopReason = undefined;
    work.followupPendingSince = null;
    work.seenTaskIds = new Set(work.liveTaskIds);
    armPromptIdleTimer();
    const resp = await agent.prompt({
      sessionId: resolvedSessionId,
      prompt: buildPromptContent(finalPromptText, params.attachments),
    });
    if (bPromptIdleTimedOut) return idleTimeoutError();
    let stopReason: string | undefined = resp.stopReason;
    if (stopReason !== 'cancelled') {
      const followup = await holdForFollowupWork(resolvedSessionId, work, {
        clearPromptIdleTimer,
        armPromptIdleTimer,
        timedOut: () => bPromptIdleTimedOut,
        novaSessionId,
      });
      if (bPromptIdleTimedOut) return idleTimeoutError();
      if (followup) stopReason = work.lastStopReason ?? stopReason;
    }
    return { acpSessionId: resolvedSessionId, stopReason };
  } catch (err) {
    if (bPromptIdleTimedOut) return idleTimeoutError();
    const errorDetail = extractAgentErrorDetail(err);
    return { acpSessionId: resolvedSessionId, error: errorDetail.message, errorDetail };
  } finally {
    clearPromptIdleTimer();
    activeHandlers.delete(resolvedSessionId);
    activeConfigSyncHandlers.delete(resolvedSessionId);
    activePermissionHandlers.delete(resolvedSessionId);
  }
}

/**
 * Keep the turn open while Claude Code's follow-up work runs: background tasks
 * still live, a task-notification follow-up queued, or a self-started cycle
 * streaming. Returns once that work has been quiet for FOLLOWUP_GRACE_MS, or at
 * once on cancel / dispose. The result says whether any follow-up ran.
 */
async function holdForFollowupWork(
  acpSessionId: string,
  work: SessionWork,
  hooks: {
    clearPromptIdleTimer: () => void;
    armPromptIdleTimer: () => void;
    timedOut: () => boolean;
    novaSessionId: string;
  }
): Promise<boolean> {
  let bHadFollowup = false;
  let bLogged = false;
  // The idle watchdog expects output; background tasks produce none until they
  // end, so it only runs while a follow-up cycle streams. Armed on the transition
  // only: re-arming on every re-check would keep it from ever firing.
  let bWatchdogArmed = false;
  hooks.clearPromptIdleTimer();
  for (;;) {
    if (work.released || hooks.timedOut()) return bHadFollowup;
    const bBusy = hasFollowupWork(work);
    if (bBusy && !bLogged) {
      bLogged = true;
      logger.info(
        { novaSessionId: hooks.novaSessionId, acpSessionId, liveTasks: work.liveTaskIds.size, foreground: work.foreground },
        'Claude turn held open for background work'
      );
    }
    const bStreaming = bBusy && work.foreground;
    if (bStreaming) bHadFollowup = true;
    if (bStreaming !== bWatchdogArmed) {
      bWatchdogArmed = bStreaming;
      if (bStreaming) hooks.armPromptIdleTimer();
      else hooks.clearPromptIdleTimer();
    }
    // A turn that never had background work cannot get a follow-up: end at once.
    if (!bBusy && work.seenTaskIds.size === 0 && work.followupPendingSince === null && !bHadFollowup) {
      return bHadFollowup;
    }
    // Busy: re-check on every change (and periodically, so a stale follow-up
    // marker times out). Quiet: give a just-finished task's follow-up a moment
    // to start before ending the turn.
    const bChanged = await waitForWorkChange(work, FOLLOWUP_GRACE_MS);
    if (!bBusy && !bChanged) return bHadFollowup;
  }
}

/** Resolves true when the session's work state changes, false after `timeoutMs`. */
function waitForWorkChange(work: SessionWork, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const wake = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      work.waiters.delete(wake);
      resolve(false);
    }, timeoutMs);
    work.waiters.add(wake);
  });
}

export function cancelClaudeAcp(acpSessionId: string): void {
  // A turn held open for background work has no prompt to interrupt; end it here.
  releaseSessionWork(acpSessionId);
  const agent = findAgentForAcpSession(acpSessionId);
  agent?.cancel({ sessionId: acpSessionId }).catch(() => {});
}

/** Tear down the embedded Claude agent for a Nova session (delete / close). */
export async function closeClaudeAcpForNovaSession(
  novaSessionId: string,
  acpSessionId?: string | null
): Promise<void> {
  const agent = agentsByNovaSession.get(novaSessionId);
  if (!agent) return;

  try {
    if (acpSessionId) {
      try {
        await agent.closeSession({ sessionId: acpSessionId });
      } catch {
        try {
          await agent.deleteSession?.({ sessionId: acpSessionId });
        } catch {
          // best-effort
        }
      }
      novaByAcpSession.delete(acpSessionId);
    }
    await agent.dispose?.();
  } catch (err) {
    logger.debug({ err, novaSessionId }, 'Claude ACP dispose failed');
  } finally {
    forgetNovaSession(novaSessionId);
  }
}
