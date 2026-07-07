/**
 * Cursor ACP integration — thin wrapper around shared subprocess runner.
 * Model is applied via ACP setSessionConfigOption each turn (not CLI --model).
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

export interface RunCursorAcpParams {
  acpSessionId: string | null;
  cwd: string;
  promptText: string;
  model?: string;
  mode?: string;
  configJson?: Record<string, string>;
}

export interface RunCursorAcpResult {
  acpSessionId: string;
  stopReason?: string;
  error?: string;
  resolvedModeId?: string;
  resolvedModelId?: string;
}

export async function runCursorAcp(
  params: RunCursorAcpParams,
  onEvent: AcpEventHandler,
  novaSessionId: string,
  onConfigSync?: SessionConfigSyncHandler
): Promise<RunCursorAcpResult> {
  return runAcpSubprocessPrompt(
    {
      command: config.cursorCommand,
      args: ['acp'],
      cwd: params.cwd,
      novaSessionId,
      acpSessionId: params.acpSessionId,
      promptText: params.promptText,
      model: params.model,
      mode: params.mode,
      configJson: params.configJson,
      logTag: 'cursorAcp',
      cursorExtensions: true,
    },
    onEvent,
    onConfigSync
  );
}

export function cancelCursorAcp(novaSessionId: string): void {
  cancelAcpSubprocess(novaSessionId);
}

export async function closeCursorAcpSession(acpSessionId: string, cwd: string): Promise<void> {
  await closeAcpSubprocessSession({
    command: config.cursorCommand,
    args: ['acp'],
    cwd,
    acpSessionId,
    logTag: 'cursorAcp',
  });
}
