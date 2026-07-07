/**
 * OpenCode ACP integration — thin wrapper around shared subprocess runner.
 */

// classes
import { config } from './config';
import {
  cancelAcpSubprocess,
  closeAcpSubprocessSession,
  runAcpSubprocessPrompt,
  type AcpEventHandler,
  type SessionConfigSyncHandler,
} from './acpSubprocessRunner';

export type { AcpEventHandler };

export interface RunOpenCodeAcpParams {
  acpSessionId: string | null;
  cwd: string;
  promptText: string;
  model?: string;
  mode?: string;
  configJson?: Record<string, string>;
}

export interface RunOpenCodeAcpResult {
  acpSessionId: string;
  stopReason?: string;
  error?: string;
  resolvedModeId?: string;
  resolvedModelId?: string;
}

export async function runOpenCodeAcp(
  params: RunOpenCodeAcpParams,
  onEvent: AcpEventHandler,
  novaSessionId: string,
  onConfigSync?: SessionConfigSyncHandler
): Promise<RunOpenCodeAcpResult> {
  return runAcpSubprocessPrompt(
    {
      command: config.openCodeAcpCommand,
      args: ['acp'],
      cwd: params.cwd,
      novaSessionId,
      acpSessionId: params.acpSessionId,
      promptText: params.promptText,
      model: params.model,
      mode: params.mode,
      configJson: params.configJson,
      logTag: 'openCodeAcp',
    },
    onEvent,
    onConfigSync
  );
}

export function cancelOpenCodeAcp(novaSessionId: string): void {
  cancelAcpSubprocess(novaSessionId);
}

export async function closeOpenCodeAcpSession(acpSessionId: string, cwd: string): Promise<void> {
  await closeAcpSubprocessSession({
    command: config.openCodeAcpCommand,
    args: ['acp'],
    cwd,
    acpSessionId,
    logTag: 'openCodeAcp',
  });
}
