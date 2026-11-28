/**
 * Claude runs through the `@agentclientprotocol/claude-agent-acp` agent, one child process per session.
 */

// node_modules
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';

// classes
import { claudeTokenSessionMeta } from '../childEnv';
import { config } from '../config';
import { db } from '../database';
import { spawnClaudeAgent } from '../claudeAgentProcess';
import { cancelClaudeAcp, closeClaudeAcpForNovaSession, runClaudeAcp } from '../claudeAcp';
import { autoApprovePermission, listCliModels } from './probes';
import { agentOptionsFromSession, withOptionFallbacks } from './sessionOptions';

// types
import type { ClaudeAgentCallbacks } from '../claudeAgentProcess';
import type {
  AgentAdapter,
  AgentConfigOptionsResult,
  AgentModelsResult,
  AgentModesResult,
  AgentOptionsProbeResult,
  AgentRunParams,
  AgentRunResult,
} from './types';

/** Claude cancels by ACP session id; track the one each running Nova session uses. */
const acpSessionIdByNovaSession = new Map<string, string | null>();

const claudeClientProxy = {
  sessionUpdate: async (): Promise<void> => {},
  requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> =>
    autoApprovePermission(params),
  extNotification: async (_method: string, _params: Record<string, unknown>): Promise<void> => {},
} satisfies ClaudeAgentCallbacks;

async function probeClaudeOptions(claudeToken?: string | null): Promise<AgentOptionsProbeResult | null> {
  const agent = spawnClaudeAgent(claudeClientProxy);
  try {
    await agent.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'nova-code', version: '1.0.0' },
      clientCapabilities: {},
    });
    const resp = await agent.newSession({
      cwd: config.configDir,
      mcpServers: [],
      _meta: claudeTokenSessionMeta(claudeToken),
    });
    const options = agentOptionsFromSession(resp);
    await agent.closeSession({ sessionId: resp.sessionId }).catch(() => {});
    return options;
  } catch {
    return null;
  } finally {
    await agent.dispose();
  }
}

export const claudeAdapter: AgentAdapter = {
  type: 'claude',

  spawnCommand: () => null,

  async run(params: AgentRunParams): Promise<AgentRunResult> {
    const { novaSessionId } = params;
    acpSessionIdByNovaSession.set(novaSessionId, params.acpSessionId);
    try {
      return await runClaudeAcp(
        {
          novaSessionId,
          acpSessionId: params.acpSessionId,
          cwd: params.cwd,
          promptText: params.promptText,
          attachments: params.attachments,
          claudeToken: params.claudeToken,
          textOnly: params.textOnly,
          model: params.model,
          mode: params.mode,
          configJson: params.configJson,
          getFreshSessionPrefix: params.getFreshSessionPrefix,
          additionalDirectories: params.additionalDirectories,
          onSessionId: (id) => {
            acpSessionIdByNovaSession.set(novaSessionId, id);
            params.onSessionId?.(id);
          },
        },
        params.onEvent,
        params.onConfigSync,
        params.onRequestPermission
      );
    } finally {
      acpSessionIdByNovaSession.delete(novaSessionId);
    }
  },

  /** Also honoured before the ACP session id is known (session setup). */
  async cancel(sessionId: string): Promise<void> {
    cancelClaudeAcp(sessionId, acpSessionIdByNovaSession.get(sessionId) ?? null);
  },

  async close(sessionId: string): Promise<void> {
    const session = await db.getSession(sessionId);
    if (!session) return;
    await closeClaudeAcpForNovaSession(sessionId, session.sessionId);
  },

  probeModels: async (): Promise<AgentModelsResult> => ({
    models: await listCliModels({ command: config.claudeCommand, args: ['models'] }),
  }),

  // Modes and config options come from the static list / options probe, not a separate session.
  probeModes: async (): Promise<AgentModesResult> => ({ modes: [] }),
  probeConfigOptions: async (): Promise<AgentConfigOptionsResult> => ({ options: [] }),

  probeOptions: async (opts?: { claudeToken?: string | null }): Promise<AgentOptionsProbeResult> =>
    withOptionFallbacks(await probeClaudeOptions(opts?.claudeToken), async () => []),
};
