/**
 * Mistral Vibe ACP integration — thin wrapper around shared subprocess runner.
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

export interface RunVibeAcpParams {
  acpSessionId: string | null;
  cwd: string;
  promptText: string;
  mode?: string;
}

export interface RunVibeAcpResult {
  acpSessionId: string;
  stopReason?: string;
  error?: string;
  resolvedModeId?: string;
}

export async function runVibeAcp(
  params: RunVibeAcpParams,
  onEvent: AcpEventHandler,
  novaSessionId: string,
  onConfigSync?: SessionConfigSyncHandler
): Promise<RunVibeAcpResult> {
  return runAcpSubprocessPrompt(
    {
      command: config.vibeAcpCommand,
      args: [],
      cwd: params.cwd,
      novaSessionId,
      acpSessionId: params.acpSessionId,
      promptText: params.promptText,
      mode: params.mode,
      logTag: 'vibeAcp',
    },
    onEvent,
    onConfigSync
  );
}

export function cancelVibeAcp(novaSessionId: string): void {
  cancelAcpSubprocess(novaSessionId);
}

export async function closeVibeAcpSession(acpSessionId: string, cwd: string): Promise<void> {
  await closeAcpSubprocessSession({
    command: config.vibeAcpCommand,
    args: [],
    cwd,
    acpSessionId,
    logTag: 'vibeAcp',
  });
}
