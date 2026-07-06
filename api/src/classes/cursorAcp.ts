/**
 * Cursor ACP integration.
 *
 * Spawns `cursor-agent acp` as a subprocess for each prompt turn and communicates via
 * the ACP protocol (newline-delimited JSON over stdio) using ClientSideConnection
 * from @agentclientprotocol/sdk.
 *
 * Keep the generic acpClientProxy pattern in sync with claudeAcp.ts and vibeAcp.ts.
 */

// node_modules
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type {
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  Client,
} from '@agentclientprotocol/sdk';

// classes
import { config } from './config';

export type AcpEventHandler = (line: string) => void;

// ── Per-prompt process tracking (keyed by Nova session ID) ───────────────────

interface ActiveProcess {
  proc: ChildProcess;
  kill: () => void;
}

const activeProcesses = new Map<string, ActiveProcess>();

// ── Permission auto-approval (same policy as claudeAcp.ts and vibeAcp.ts) ────────

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

// ── Node → Web stream converters ─────────────────────────────────────────────

function nodeReadableToWeb(readable: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      readable.on('data', (chunk: Buffer | string) => {
        controller.enqueue(typeof chunk === 'string' ? Buffer.from(chunk) : new Uint8Array(chunk));
      });
      readable.on('end', () => controller.close());
      readable.on('error', (err) => controller.error(err));
    },
  });
}

function nodeWritableToWeb(writable: NodeJS.WritableStream): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        writable.write(chunk, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        writable.end(resolve);
      });
    },
  });
}

// ── Active session handler map (cursorSessionId → handler) ──────────────────

const activeHandlers = new Map<string, AcpEventHandler>();

function formatProcessExit(code: number | null, signal: NodeJS.Signals | null): string {
  return signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
}

function formatAcpError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const details = err as Error & { code?: unknown; data?: unknown };
  const parts = [err.name ? `${err.name}: ${err.message}` : err.message];
  if (details.code !== undefined) parts.push(`code=${String(details.code)}`);
  if (details.data !== undefined) parts.push(`data=${JSON.stringify(details.data)}`);
  return parts.join(' ');
}

async function withProcessStartupGuard<T>(
  proc: ChildProcess,
  phase: string,
  operation: Promise<T>,
  timeoutMs = 30_000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`cursor-agent acp timed out during ${phase}`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      proc.off('error', onError);
      proc.off('exit', onExit);
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`cursor-agent acp exited during ${phase} with ${formatProcessExit(code, signal)}`));
    };

    proc.once('error', onError);
    proc.once('exit', onExit);
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (err: unknown) => {
        cleanup();
        console.error(`[cursorAcp] ${phase} failed:`, formatAcpError(err));
        reject(err);
      }
    );
  });
}

async function handleCursorExtensionMethod(
  method: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  console.log('[cursorAcp] extension request:', method, params);

  if (method === 'cursor/ask_question') {
    return { outcome: { outcome: 'skipped', reason: 'Nova Code does not support interactive questions yet.' } };
  }

  if (method === 'cursor/create_plan') {
    return { outcome: { outcome: 'accepted' } };
  }

  if (method === 'cursor/update_todos') {
    return { outcome: { outcome: 'accepted', todos: Array.isArray(params.todos) ? params.todos : [] } };
  }

  if (method === 'cursor/task') {
    return { outcome: { outcome: 'completed' } };
  }

  if (method === 'cursor/generate_image') {
    return { outcome: { outcome: 'rejected', reason: 'Nova Code does not support image generation yet.' } };
  }

  return {};
}

// ── Spawn cursor-agent ACP and establish ACP connection ───────────────────────

function cursorAcpArgs(model?: string): string[] {
  const selectedModel = model?.trim();
  if (selectedModel && selectedModel !== 'auto') {
    return ['--model', selectedModel, 'acp'];
  }
  return ['acp'];
}

async function spawnCursorConnection(cwd: string, model?: string): Promise<{
  conn: ClientSideConnection;
  proc: ChildProcess;
}> {
  const env = { ...process.env, ...config.agentEnv() };
  const cursorCommand = config.cursorCommand;
  if (!cursorCommand) {
    throw new Error('Cursor ACP command is not configured');
  }
  const args = cursorAcpArgs(model);
  console.log('[cursorAcp] spawning Cursor ACP server:', cursorCommand, args);
  const proc = spawn(cursorCommand, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });

  // Permanent listeners so a dying child never surfaces as an uncaught
  // 'error' event / unhandled rejection that would kill the whole API process.
  proc.on('error', (err) => console.error('[cursorAcp] process error:', err));
  proc.stdin?.on('error', (err) => console.error('[cursorAcp] stdin error:', err.message));
  proc.stdout?.on('error', (err) => console.error('[cursorAcp] stdout error:', err.message));
  proc.on('exit', (code, signal) => {
    console.log('[cursorAcp] process exited with', formatProcessExit(code, signal));
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.error('[cursorAcp] stderr:', text);
  });

  const webReadable = nodeReadableToWeb(proc.stdout!);
  const webWritable = nodeWritableToWeb(proc.stdin!);
  const stream = ndJsonStream(webWritable, webReadable);

  const conn = new ClientSideConnection(
    (_agent): Client => ({
      sessionUpdate: async (notification: SessionNotification): Promise<void> => {
        const handler = activeHandlers.get(notification.sessionId);
        if (handler) handler(JSON.stringify(notification));
      },
      requestPermission: handlePermissionRequest,
      readTextFile: async () => ({ content: '' }),
      writeTextFile: async () => ({}),
      extMethod: handleCursorExtensionMethod,
      extNotification: async (method: string, params: Record<string, unknown>): Promise<void> => {
        console.log('[cursorAcp] extension notification:', method, params);
      },
    }),
    stream
  );

  // The SDK rejects conn.closed when the child dies; without a handler that
  // becomes a fatal unhandled rejection ("Error: ACP connection closed").
  void Promise.resolve(conn.closed).catch((err: unknown) => {
    console.error('[cursorAcp] connection closed:', err instanceof Error ? err.message : err);
  });

  const init = await withProcessStartupGuard(
    proc,
    'initialize',
    conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'nova-code', version: '1.0.0' },
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    })
  );

  const authMethods = init.authMethods ?? [];
  const authMethodIds = authMethods.map((method) => method.id);
  console.log('[cursorAcp] initialized Cursor ACP server:', {
    protocolVersion: init.protocolVersion,
    agentInfo: init.agentInfo,
    authMethods: authMethodIds,
  });

  return { conn, proc };
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface RunCursorAcpParams {
  /** Cursor session ID from a previous run — null to start a new session. */
  acpSessionId: string | null;
  cwd: string;
  promptText: string;
  model?: string;
}

export interface RunCursorAcpResult {
  /** Cursor session ID — persist in the DB for conversation continuity. */
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
  const { acpSessionId, cwd, promptText, model } = params;

  let conn: ClientSideConnection;
  let proc: ChildProcess;
  try {
    ({ conn, proc } = await spawnCursorConnection(cwd, model));
  } catch (err) {
    return { acpSessionId: acpSessionId ?? '', error: String(err) };
  }

  const killProc = () => {
    try {
      proc.kill();
    } catch {
      // already dead
    }
  };

  activeProcesses.set(novaSessionId, { proc, kill: killProc });

  try {
    let resolvedSessionId: string;

    if (!acpSessionId) {
      // First turn — create a new session
      const resp = await withProcessStartupGuard(proc, 'newSession', conn.newSession({ cwd, mcpServers: [] }));
      resolvedSessionId = resp.sessionId;
    } else {
      // Subsequent turn — restore from disk.
      // loadSession() replays history via sessionUpdate; install a null handler
      // to discard those replay events before the real prompt turn starts.
      activeHandlers.set(acpSessionId, () => {});
      try {
        await withProcessStartupGuard(
          proc,
          'loadSession',
          conn.loadSession({ sessionId: acpSessionId, cwd, mcpServers: [] })
        );
        resolvedSessionId = acpSessionId;
      } catch (err) {
        console.warn('[cursorAcp] loadSession failed, starting fresh session:', err);
        activeHandlers.delete(acpSessionId);
        const resp = await withProcessStartupGuard(proc, 'newSession', conn.newSession({ cwd, mcpServers: [] }));
        resolvedSessionId = resp.sessionId;
      }
      activeHandlers.delete(acpSessionId);
    }

    activeHandlers.set(resolvedSessionId, onEvent);
    try {
      const resp = await withProcessStartupGuard(
        proc,
        'prompt',
        conn.prompt({
          sessionId: resolvedSessionId,
          prompt: [{ type: 'text', text: promptText }],
        }),
        2 * 60 * 60 * 1000
      );
      return { acpSessionId: resolvedSessionId, stopReason: resp.stopReason };
    } catch (err) {
      return { acpSessionId: resolvedSessionId, error: String(err) };
    } finally {
      activeHandlers.delete(resolvedSessionId);
    }
  } catch (err) {
    return { acpSessionId: acpSessionId ?? '', error: String(err) };
  } finally {
    activeProcesses.delete(novaSessionId);
    killProc();
  }
}

export function cancelCursorAcp(novaSessionId: string): void {
  activeProcesses.get(novaSessionId)?.kill();
}
