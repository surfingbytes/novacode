/**
 * Cursor ACP integration — thin wrapper around shared subprocess runner.
 *
 * Model selection: cursor-agent's ACP ignores runtime model changes made via
 * `session/set_config_option` for actual inference (confirmed cursor bug — metadata updates but the
 * backend keeps serving the model the process started with). A fresh `cursor-agent` process is
 * spawned per prompt turn, so we pin the selected model with the `--model <id>` startup flag, which
 * is the only reliable mechanism, and skip the ineffective config-option write.
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
  // `cursor-agent --model <id> acp` — pin the model at startup (the reliable path, since Cursor
  // ignores runtime config-option model changes). `auto` is a real model id (its own router that
  // identifies as "auto"), so it must be passed explicitly too — only omit when nothing is selected.
  const model = params.model?.trim();
  const args = model ? ['--model', model, 'acp'] : ['acp'];

  return runAcpSubprocessPrompt(
    {
      command: config.cursorCommand,
      args,
      cwd: params.cwd,
      novaSessionId,
      acpSessionId: params.acpSessionId,
      promptText: params.promptText,
      model: params.model,
      mode: params.mode,
      configJson: params.configJson,
      logTag: 'cursorAcp',
      cursorExtensions: true,
      skipModelConfigOption: true,
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
