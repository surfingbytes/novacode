/**
 * Codex ACP integration — thin wrapper around shared subprocess runner.
 */

// classes
import { config } from './config';
import {
  cancelAcpSubprocess,
  runAcpSubprocessPrompt,
  type AcpEventHandler,
  type SessionConfigSyncHandler,
} from './acpSubprocessRunner';

export type { AcpEventHandler };

export interface RunCodexAcpParams {
  acpSessionId: string | null;
  cwd: string;
  promptText: string;
  model?: string;
  mode?: string;
  configJson?: Record<string, string>;
}

export interface RunCodexAcpResult {
  acpSessionId: string;
  stopReason?: string;
  error?: string;
  resolvedModeId?: string;
  resolvedModelId?: string;
}

export async function runCodexAcp(
  params: RunCodexAcpParams,
  onEvent: AcpEventHandler,
  novaSessionId: string,
  onConfigSync?: SessionConfigSyncHandler
): Promise<RunCodexAcpResult> {
  return runAcpSubprocessPrompt(
    {
      command: config.codexAcpCommand,
      args: ['acp'],
      cwd: params.cwd,
      novaSessionId,
      acpSessionId: params.acpSessionId,
      promptText: params.promptText,
      model: params.model,
      mode: params.mode,
      configJson: params.configJson,
      logTag: 'codexAcp',
    },
    onEvent,
    onConfigSync
  );
}

export function cancelCodexAcp(novaSessionId: string): void {
  cancelAcpSubprocess(novaSessionId);
}

export async function closeCodexAcpSession(acpSessionId: string, cwd: string): Promise<void> {
  const { closeAcpSubprocessSession } = await import('./acpSubprocessRunner');
  await closeAcpSubprocessSession({
    command: config.codexAcpCommand,
    args: ['acp'],
    cwd,
    acpSessionId,
    logTag: 'codexAcp',
  });
}
