/**
 * Cursor agent integration.
 *
 * This deliberately calls `cursor-agent` directly instead of going through the
 * third-party cursor-agent-acp adapter. The adapter keeps its own model/session
 * state and has repeatedly allowed Nova's selected model to drift back to Auto.
 * Passing `--model` to the real Cursor CLI on every prompt is the authoritative
 * path and matches the model list returned by `cursor-agent models`.
 */

// node_modules
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

// classes
import { config } from './config';

export type AcpEventHandler = (line: string) => void;

// ── Per-prompt process tracking (keyed by Nova session ID) ───────────────────

interface ActiveProcess {
  proc: ChildProcess;
  kill: () => void;
}

const activeProcesses = new Map<string, ActiveProcess>();

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

function parseCreatedChatId(output: string): string | null {
  const cleaned = stripAnsi(output)
    .replace(/\r\n/g, '\n')
    .trim()
    .split('\x1B')
    .shift()
    ?.trim();
  return cleaned || null;
}

async function createCursorChat(cwd: string): Promise<{ chatId?: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn(config.cursorCommand, ['-f', 'create-chat'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...config.agentEnv() },
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ error: 'cursor-agent create-chat timed out' });
    }, 30_000);
    proc.stdout?.on('data', (chunk: string | Uint8Array) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: string | Uint8Array) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err: Error) => {
      clearTimeout(timeout);
      resolve({ error: err.message });
    });
    proc.on('close', (code: number | null) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve({ error: stripAnsi(stderr || stdout).trim() || `cursor-agent create-chat exited with code ${code}` });
        return;
      }
      const chatId = parseCreatedChatId(stdout);
      if (!chatId) {
        resolve({ error: 'No chat id returned by cursor-agent create-chat' });
        return;
      }
      resolve({ chatId });
    });
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface RunCursorAcpParams {
  /** Cursor chat ID from a previous run — null to start a new chat. */
  acpSessionId: string | null;
  cwd: string;
  promptText: string;
  model?: string;
}

export interface RunCursorAcpResult {
  /** Cursor chat ID — persist in the DB for conversation continuity. */
  acpSessionId: string;
  stopReason?: string;
  error?: string;
}

export async function runCursorAcp(
  params: RunCursorAcpParams,
  onEvent: AcpEventHandler,
  /** Nova Code session ID — used to track this run for cancellation. */
  novaSessionId: string
): Promise<RunCursorAcpResult> {
  const { acpSessionId, cwd, promptText } = params;
  const model = params.model && params.model !== 'auto' ? params.model : undefined;
  let cursorChatId = acpSessionId;
  if (!cursorChatId) {
    const created = await createCursorChat(cwd);
    if (!created.chatId) {
      return { acpSessionId: '', error: created.error ?? 'Failed to create Cursor chat' };
    }
    cursorChatId = created.chatId;
  }

  const runPrompt = (chatId: string, allowResumeRetry: boolean): Promise<RunCursorAcpResult> =>
    new Promise((resolve) => {
      const args = [
        ...(model ? ['--model', model] : []),
        '--resume',
        chatId,
        '--print',
        '--output-format',
        'stream-json',
        '--stream-partial-output',
        '--force',
        promptText,
      ];
      console.log('[cursorAcp] running cursor-agent', {
        cwd,
        model: model ?? 'auto',
        cursorChatId: chatId,
        args: args.map((arg) => (arg === promptText ? '<prompt>' : arg)),
      });

      const proc = spawn(config.cursorCommand, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...config.agentEnv() },
      });
      const killProc = () => {
        try {
          proc.kill();
        } catch {
          // already dead
        }
      };
      activeProcesses.set(novaSessionId, { proc, kill: killProc });

      let stderr = '';
      let stdoutBuffer = '';
      let settled = false;
      const settle = (result: RunCursorAcpResult): void => {
        if (settled) return;
        settled = true;
        activeProcesses.delete(novaSessionId);
        resolve(result);
      };

      proc.stdout?.on('data', (chunk: string | Uint8Array) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) onEvent(trimmed);
        }
      });
      proc.stderr?.on('data', (chunk: string | Uint8Array) => {
        stderr += chunk.toString();
      });
      proc.on('error', (err: Error) => {
        settle({ acpSessionId: chatId, error: err.message });
      });
      proc.on('close', (code: number | null) => {
        const trailing = stdoutBuffer.trim();
        if (trailing) onEvent(trailing);
        if (code !== 0) {
          if (allowResumeRetry) {
            void (async () => {
              const created = await createCursorChat(cwd);
              if (!created.chatId) {
                settle({
                  acpSessionId: chatId,
                  error: (created.error ?? stripAnsi(stderr).trim()) || `cursor-agent exited with code ${code}`,
                });
                return;
              }
              console.warn('[cursorAcp] resume failed, retrying with a fresh Cursor chat', {
                previousChatId: chatId,
                nextChatId: created.chatId,
                stderr: stripAnsi(stderr).trim(),
              });
              const retryResult = await runPrompt(created.chatId, false);
              settle(retryResult);
            })();
            return;
          }
          settle({
            acpSessionId: chatId,
            error: stripAnsi(stderr).trim() || `cursor-agent exited with code ${code}`,
          });
          return;
        }
        settle({ acpSessionId: chatId, stopReason: 'completed' });
      });
    });

  return runPrompt(cursorChatId, true);
}

export function cancelCursorAcp(novaSessionId: string): void {
  activeProcesses.get(novaSessionId)?.kill();
}
