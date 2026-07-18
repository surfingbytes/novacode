// node_modules
// @agentclientprotocol/claude-agent-acp is ESM-only. TypeScript (module: commonjs) compiles
// import() → require(), which fails for ESM packages. We use a new Function('m','return import(m)')
// wrapper so the import stays as a true ESM dynamic import at runtime. Types are import-type only.
import type { AgentSideConnection } from '@agentclientprotocol/sdk';
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
import type { SessionConfigSyncHandler } from './acpSubprocessRunner';

export type AcpEventHandler = (line: string) => void;
// Re-used by any ACP agent added later (Mistral, etc.).

// Routes streaming notifications per ACP session ID to the active prompt's handler.
const activeHandlers = new Map<string, AcpEventHandler>();
const activeConfigSyncHandlers = new Map<string, SessionConfigSyncHandler>();

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
    const config: Record<string, string> = {};
    for (const opt of update.configOptions) {
      if (opt.type !== 'select') continue;
      const cat = opt.category ?? opt.id;
      if (cat === 'mode' || cat === 'model' || opt.id === 'mode' || opt.id === 'model') continue;
      if ('currentValue' in opt && typeof opt.currentValue === 'string') {
        config[opt.id] = opt.currentValue;
      }
    }
    if (Object.keys(config).length > 0) sync.config = config;
    if (sync.modelId || sync.config) emitClaudeConfigSync(sessionId, sync);
  }
}

// Auto-approve all tool permissions — agent runs in a trusted backend context.
async function handlePermissionRequest(
  params: RequestPermissionRequest
): Promise<RequestPermissionResponse> {
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
} satisfies Partial<AgentSideConnection>;

// --------------------------------------------- Claude-specific agent ---------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharedAgent: any = null;

// new Function wrapper prevents TypeScript (module: commonjs) from compiling import() → require().
// At runtime this stays as a true ESM dynamic import, which can load ESM-only packages.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const esmImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;

// Lazily imports the ESM-only package and constructs the singleton agent.
async function getSharedAgent(): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!sharedAgent) {
    const { ClaudeAcpAgent } = await esmImport('@agentclientprotocol/claude-agent-acp');
    sharedAgent = new ClaudeAcpAgent(acpClientProxy as unknown as AgentSideConnection);
  }
  return sharedAgent;
}

// --------------------------------------------- Public API ---------------------------------------------

export interface RunClaudeAcpParams {
  /** ACP session ID from a previous run — null to start a new session. */
  acpSessionId: string | null;
  cwd: string;
  promptText: string;
  /** Optional OAuth token forwarded as CLAUDE_CODE_OAUTH_TOKEN. */
  claudeToken?: string | null;
  model?: string;
  mode?: string;
  configJson?: Record<string, string>;
  /** Called with the resolved session ID before the prompt starts — used to keep cancel state in sync. */
  onSessionId?: (id: string) => void;
}

export interface RunClaudeAcpResult {
  /** ACP session ID — persist in the DB for conversation continuity. */
  acpSessionId: string;
  stopReason?: string;
  error?: string;
}

export async function runClaudeAcp(
  params: RunClaudeAcpParams,
  onEvent: AcpEventHandler,
  onConfigSync?: SessionConfigSyncHandler
): Promise<RunClaudeAcpResult> {
  const { acpSessionId, cwd, promptText, claudeToken, model, mode, configJson, onSessionId } = params;

  if (claudeToken) {
    process.env['CLAUDE_CODE_OAUTH_TOKEN'] = claudeToken;
  }

  const agent = await getSharedAgent();
  let resolvedSessionId: string;
  let sessionResponse: AcpSessionResponse;

  if (!acpSessionId) {
    const created = await agent.newSession({ cwd, mcpServers: [] });
    sessionResponse = created;
    resolvedSessionId = created.sessionId;
  } else {
    try {
      sessionResponse = await agent.resumeSession({ sessionId: acpSessionId, cwd, mcpServers: [] });
      resolvedSessionId = acpSessionId;
    } catch {
      const created = await agent.newSession({ cwd, mcpServers: [] });
      sessionResponse = created;
      resolvedSessionId = created.sessionId;
    }
  }

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
  try {
    const resp = await agent.prompt({
      sessionId: resolvedSessionId,
      prompt: [{ type: 'text', text: promptText }],
    });
    return { acpSessionId: resolvedSessionId, stopReason: resp.stopReason };
  } catch (err) {
    return { acpSessionId: resolvedSessionId, error: String(err) };
  } finally {
    activeHandlers.delete(resolvedSessionId);
    activeConfigSyncHandlers.delete(resolvedSessionId);
  }
}

export function cancelClaudeAcp(acpSessionId: string): void {
  sharedAgent?.cancel({ sessionId: acpSessionId }).catch(() => {});
}
