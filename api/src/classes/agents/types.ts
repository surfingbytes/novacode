/**
 * One adapter per agent type: how it is spawned, how one prompt turn runs and how its models,
 * modes and config options are probed. Callers go through `getAgentAdapter(type)` instead of
 * switching on the agent type.
 */

// types
import type { AgentType } from '@novacode/shared';
import type { AgentErrorDetail } from '../agentError';
import type {
  AcpAskQuestionHandler,
  AcpEventHandler,
  AcpPermissionHandler,
  AcpPromptAttachment,
  SessionConfigSyncHandler,
} from '../acpSubprocessRunner';

export interface AgentRunParams {
  /** Nova session (or one-shot run) id; keys cancel() for this run. */
  novaSessionId: string;
  acpSessionId: string | null;
  cwd: string;
  promptText: string;
  attachments?: AcpPromptAttachment[];
  model?: string;
  mode?: string;
  configJson?: Record<string, string>;
  /** Lazy rules-prefix builder, invoked only when a fresh ACP session is created. */
  getRulesPrefix?: () => Promise<string>;
  /** Extra dirs the agent may use without per-file approval (ACP additionalDirectories). */
  additionalDirectories?: string[];
  /** Claude OAuth token; ignored by subprocess agents. */
  claudeToken?: string | null;
  /** Called as soon as the ACP session id is known (Claude only; subprocess agents report it in the result). */
  onSessionId?: (id: string) => void;
  onEvent: AcpEventHandler;
  onConfigSync?: SessionConfigSyncHandler;
  onRequestPermission?: AcpPermissionHandler;
  /** Cursor `cursor/ask_question` extension; ignored by other agents. */
  onAskQuestion?: AcpAskQuestionHandler;
}

export interface AgentRunResult {
  acpSessionId: string;
  stopReason?: string;
  error?: string;
  errorDetail?: AgentErrorDetail;
  resolvedModeId?: string;
  resolvedModelId?: string;
}

/** Model as listed by the agent, before it is split into model/thinking/context dimensions. */
export interface RawAgentModel {
  id: string;
  label: string;
  current?: boolean;
}

export interface AgentModelOption {
  id: string;
  label: string;
  model: string;
  thinking: string;
  context: string;
  fast: boolean | null;
  current?: boolean;
}

export interface AgentModeOption {
  id: string;
  label: string;
  description?: string;
  current?: boolean;
}

export interface AgentConfigSelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface AgentConfigOption {
  id: string;
  label: string;
  description?: string;
  category?: string;
  options: AgentConfigSelectOption[];
  currentValue?: string;
}

export interface AgentThinkingOptionGroup {
  configId: string;
  label: string;
  description?: string;
  options: AgentConfigSelectOption[];
  currentValue?: string;
}

/** Empty list = probe failed or unsupported; callers apply their own fallbacks. */
export interface AgentModelsResult {
  models: RawAgentModel[];
}

export interface AgentModesResult {
  modes: AgentModeOption[];
}

export interface AgentConfigOptionsResult {
  options: AgentConfigOption[];
}

/** Combined options shown in the agent picker (models, modes, config, thinking). */
export interface AgentOptionsProbeResult {
  models: AgentModelOption[];
  modes: AgentModeOption[];
  configOptions: AgentConfigOption[];
  thinking: AgentThinkingOptionGroup | null;
  source: 'cli' | 'acp' | 'mixed' | 'static';
}

export interface AgentAdapter {
  type: AgentType;
  /** null = in-process (Claude). */
  spawnCommand(): { command: string; args: string[] } | null;
  /** One prompt turn. */
  run(params: AgentRunParams): Promise<AgentRunResult>;
  /** Stop the running turn of this Nova session. */
  cancel(sessionId: string): Promise<void>;
  /** Close the ACP session stored on this Nova session (best effort). */
  close(sessionId: string): Promise<void>;
  probeModels(): Promise<AgentModelsResult>;
  probeModes(): Promise<AgentModesResult>;
  probeConfigOptions(): Promise<AgentConfigOptionsResult>;
  /** Combined picker options with the agent's own fallbacks applied (uncached). */
  probeOptions(opts?: { claudeToken?: string | null }): Promise<AgentOptionsProbeResult>;
}
