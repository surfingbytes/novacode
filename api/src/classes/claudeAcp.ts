// node_modules
// @agentclientprotocol/claude-agent-acp is ESM-only. TypeScript (module: commonjs) compiles
// import() → require(), which fails for ESM packages. We use a new Function('m','return import(m)')
// wrapper so the import stays as a true ESM dynamic import at runtime. Types are import-type only.
import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type {
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
  CreateTerminalRequest,
} from '@agentclientprotocol/sdk';

// classes
import { applySessionMode, applySessionModel, applySessionConfig } from './acpSessionHelpers';
import type { AcpSessionResponse } from './acpSessionHelpers';
import { extractAgentErrorDetail } from './agentError';
import type { AgentErrorDetail } from './agentError';
import { logger } from './logger';
import { config } from './config';
import { getConfiguredAcpMcpServers } from './mcpServersForAcp';
import { buildPromptContent, sessionResetNoticeEventLine } from './acpSubprocessRunner';
import type { AcpPermissionHandler, AcpPromptAttachment, SessionConfigSyncHandler } from './acpSubprocessRunner';

export type AcpEventHandler = (line: string) => void;
// Re-used by any ACP agent added later (Mistral, etc.).

// Routes streaming notifications per ACP session ID to the active prompt's handler.
const activeHandlers = new Map<string, AcpEventHandler>();
const activeConfigSyncHandlers = new Map<string, SessionConfigSyncHandler>();
const activePermissionHandlers = new Map<string, AcpPermissionHandler>();

// One ClaudeAcpAgent per Nova session so parallel chats cannot share query/task
// state inside a singleton agent (which previously made two sessions feel like one).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const agentsByNovaSession = new Map<string, any>();
const novaByAcpSession = new Map<string, string>();
const initializedNovaSessions = new Set<string>();

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

// Duck-typed ACP client proxy satisfying the AgentSideConnection interface at runtime.
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
  createTerminal: async (_params: CreateTerminalRequest): Promise<never> => {
    throw new Error('[claudeAcp] createTerminal not supported in embedded mode');
  },
  // Claude ACP ≥0.84 sends `_auth/status_update` (and similar) via extNotification;
  // unknown methods are meant to be dropped silently by clients.
  extNotification: async (_method: string, _params: Record<string, unknown>): Promise<void> => {},
} satisfies Partial<AgentSideConnection>;

// --------------------------------------------- Claude-specific agent ---------------------------------------------

// new Function wrapper prevents TypeScript (module: commonjs) from compiling import() → require().
// At runtime this stays as a true ESM dynamic import, which can load ESM-only packages.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const esmImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ClaudeAcpAgentCtor: (new (client: AgentSideConnection) => any) | null = null;

async function loadClaudeAcpAgentCtor(): Promise<new (client: AgentSideConnection) => any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!ClaudeAcpAgentCtor) {
    const mod = await esmImport('@agentclientprotocol/claude-agent-acp');
    ClaudeAcpAgentCtor = mod.ClaudeAcpAgent;
  }
  return ClaudeAcpAgentCtor!;
}

async function getAgentForNovaSession(novaSessionId: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  let agent = agentsByNovaSession.get(novaSessionId);
  if (!agent) {
    const Ctor = await loadClaudeAcpAgentCtor();
    agent = new Ctor(acpClientProxy as unknown as AgentSideConnection);
    agentsByNovaSession.set(novaSessionId, agent);
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
  const mcpServers = await getConfiguredAcpMcpServers(config.configDir);
  let resolvedSessionId: string;
  let sessionResponse: AcpSessionResponse;
  /** True when a brand-new conversation was created (rules must be injected). */
  let isFreshSession = false;

  if (!acpSessionId) {
    const created = await agent.newSession({ cwd, mcpServers, ...extraDirs });
    sessionResponse = created;
    resolvedSessionId = created.sessionId;
    isFreshSession = true;
  } else {
    try {
      sessionResponse = await agent.resumeSession({ sessionId: acpSessionId, cwd, mcpServers, ...extraDirs });
      resolvedSessionId = acpSessionId;
    } catch {
      onEvent(sessionResetNoticeEventLine());
      const created = await agent.newSession({ cwd, mcpServers, ...extraDirs });
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

  onSessionId?.(resolvedSessionId);
  activeHandlers.set(resolvedSessionId, onEvent);
  if (onConfigSync) activeConfigSyncHandlers.set(resolvedSessionId, onConfigSync);
  if (onRequestPermission) activePermissionHandlers.set(resolvedSessionId, onRequestPermission);
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
    const resp = await agent.prompt({
      sessionId: resolvedSessionId,
      prompt: buildPromptContent(finalPromptText, params.attachments),
    });
    return { acpSessionId: resolvedSessionId, stopReason: resp.stopReason };
  } catch (err) {
    const errorDetail = extractAgentErrorDetail(err);
    return { acpSessionId: resolvedSessionId, error: errorDetail.message, errorDetail };
  } finally {
    activeHandlers.delete(resolvedSessionId);
    activeConfigSyncHandlers.delete(resolvedSessionId);
    activePermissionHandlers.delete(resolvedSessionId);
  }
}

export function cancelClaudeAcp(acpSessionId: string): void {
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
    agentsByNovaSession.delete(novaSessionId);
    initializedNovaSessions.delete(novaSessionId);
    for (const [acpId, novaId] of novaByAcpSession.entries()) {
      if (novaId === novaSessionId) novaByAcpSession.delete(acpId);
    }
  }
}
