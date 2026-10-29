/**
 * Shared base for agents that speak ACP over a spawned subprocess (Cursor, Codex, OpenCode,
 * Mistral Vibe). Subclasses only describe the command and their quirks.
 */

// classes
import { db } from '../database';
import { resolveWorkspaceAbsolutePath } from '../workspacePaths';
import {
  cancelAcpSubprocess,
  closeAcpSubprocessSession,
  runAcpSubprocessPrompt,
  type AcpSubprocessRunParams,
} from '../acpSubprocessRunner';
import { listCliModelIds, listCliModels, probeAcpNewSession, type CommandSpec } from './probes';
import { agentOptionsFromSession, configOptionsFromSession, modesFromSessionResponse, withOptionFallbacks } from './sessionOptions';

// types
import type { AgentType } from '@novacode/shared';
import type {
  AgentAdapter,
  AgentConfigOptionsResult,
  AgentModelOption,
  AgentModelsResult,
  AgentModesResult,
  AgentOptionsProbeResult,
  AgentRunParams,
  AgentRunResult,
} from './types';

export interface AcpSubprocessAdapterSpec {
  type: AgentType;
  logTag: string;
  /** ACP command; a getter because config values are read lazily. */
  command: () => string;
  args: string[];
  /** `<agent> models` CLI used for the model list; omit when the agent has a dedicated probe. */
  modelsCommand?: () => CommandSpec;
}

/** Runner fields an adapter may override per turn (agent quirks). */
export type AcpSubprocessQuirks = Partial<Omit<AcpSubprocessRunParams, 'cwd' | 'novaSessionId' | 'acpSessionId' | 'promptText' | 'logTag'>>;

export class AcpSubprocessAdapter implements AgentAdapter {
  readonly type: AgentType;

  constructor(protected readonly spec: AcpSubprocessAdapterSpec) {
    this.type = spec.type;
  }

  spawnCommand(): CommandSpec {
    return { command: this.spec.command(), args: [...this.spec.args] };
  }

  /** Per-turn overrides of the runner params (startup args, prompt rewrites, ignored fields...). */
  protected quirks(_params: AgentRunParams): AcpSubprocessQuirks {
    return {};
  }

  /** Only Cursor implements the ask-question extension. */
  protected readonly forwardsAskQuestion: boolean = false;

  async run(params: AgentRunParams): Promise<AgentRunResult> {
    const { command, args } = this.spawnCommand();
    return runAcpSubprocessPrompt(
      {
        command,
        args,
        cwd: params.cwd,
        novaSessionId: params.novaSessionId,
        acpSessionId: params.acpSessionId,
        promptText: params.promptText,
        attachments: params.attachments,
        model: params.model,
        mode: params.mode,
        configJson: params.configJson,
        getRulesPrefix: params.getRulesPrefix,
        additionalDirectories: params.additionalDirectories,
        logTag: this.spec.logTag,
        ...this.quirks(params),
      },
      params.onEvent,
      params.onConfigSync,
      params.onRequestPermission,
      this.forwardsAskQuestion ? params.onAskQuestion : undefined
    );
  }

  async cancel(sessionId: string): Promise<void> {
    cancelAcpSubprocess(sessionId);
  }

  async close(sessionId: string): Promise<void> {
    const session = await db.getSession(sessionId);
    if (!session?.sessionId) return;
    const workspace = await db.getWorkspace(session.workspaceId);
    if (!workspace) return;
    await this.closeAcpSession(session.sessionId, resolveWorkspaceAbsolutePath(workspace.path));
  }

  /** `session/close` (or delete) for a known ACP session id. */
  async closeAcpSession(acpSessionId: string, cwd: string): Promise<void> {
    const { command, args } = this.spawnCommand();
    await closeAcpSubprocessSession({ command, args, cwd, acpSessionId, logTag: this.spec.logTag });
  }

  async probeModels(): Promise<AgentModelsResult> {
    return { models: this.spec.modelsCommand ? await listCliModels(this.spec.modelsCommand()) : [] };
  }

  async probeModes(): Promise<AgentModesResult> {
    const resp = await probeAcpNewSession(this.spawnCommand());
    return {
      modes: resp
        ? modesFromSessionResponse(
            resp.modes,
            resp.configOptions as Parameters<typeof modesFromSessionResponse>[1]
          )
        : [],
    };
  }

  async probeConfigOptions(): Promise<AgentConfigOptionsResult> {
    const resp = await probeAcpNewSession(this.spawnCommand());
    return { options: resp ? configOptionsFromSession(resp.configOptions) : [] };
  }

  async probeOptions(): Promise<AgentOptionsProbeResult> {
    const resp = await probeAcpNewSession(this.spawnCommand());
    return withOptionFallbacks(resp ? agentOptionsFromSession(resp) : null, () => this.fallbackModels());
  }

  /** Models for the options picker when the ACP probe lists none. */
  protected async fallbackModels(): Promise<AgentModelOption[]> {
    return this.spec.modelsCommand ? listCliModelIds(this.spec.modelsCommand()) : [];
  }
}
