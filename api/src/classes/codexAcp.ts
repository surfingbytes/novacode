/**
 * Codex ACP integration.
 *
 * Spawns `codex-acp` as a subprocess for each prompt turn and communicates via
 * the ACP protocol (newline-delimited JSON over stdio) using ClientSideConnection
 * from @agentclientprotocol/sdk.
 *
 * Keep the generic acpClientProxy pattern in sync with cursorAcp.ts and vibeAcp.ts.
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

// ── Permission auto-approval (same policy as claudeAcp.ts and vibeAcp.ts) ──────

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

// ── Active session handler map (codexSessionId → handler) ──────────────────

const activeHandlers = new Map<string, AcpEventHandler>();

// ── Spawn codex-acp and establish ACP connection ────────────────────────

async function spawnCodexConnection(cwd: string): Promise<{
  conn: ClientSideConnection;
  proc: ChildProcess;
}> {
  const env = { ...process.env, ...config.agentEnv() };
  const proc = spawn(config.codexAcpCommand, ['acp'], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.error('[codexAcp] stderr:', text);
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
    }),
    stream
  );

  await conn.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientInfo: { name: 'nova-code', version: '1.0.0' },
    clientCapabilities: {},
  });

  return { conn, proc };
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface RunCodexAcpParams {
  /** Codex session ID from a previous run — null to start a new session. */
  acpSessionId: string | null;
  cwd: string;
  promptText: string;
  model?: string;
}

export interface RunCodexAcpResult {
  /** Codex session ID — persist in the DB for conversation continuity. */
  acpSessionId: string;
  stopReason?: string;
  error?: string;
}

export async function runCodexAcp(
  params: RunCodexAcpParams,
  onEvent: AcpEventHandler,
  /** Nova Code session ID — used to track this run for cancellation. */
  novaSessionId: string
): Promise<RunCodexAcpResult> {
  const { acpSessionId, cwd, promptText } = params;

  const { conn, proc } = await spawnCodexConnection(cwd);
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
      const resp = await conn.newSession({ cwd, mcpServers: [] });
      resolvedSessionId = resp.sessionId;
    } else {
      // Subsequent turn — restore from disk.
      // loadSession() replays history via sessionUpdate; install a null handler
      // to discard those replay events before the real prompt turn starts.
      activeHandlers.set(acpSessionId, () => {});
      try {
        await conn.loadSession({ sessionId: acpSessionId, cwd, mcpServers: [] });
        resolvedSessionId = acpSessionId;
      } catch (err) {
        console.warn('[codexAcp] loadSession failed, starting fresh session:', err);
        activeHandlers.delete(acpSessionId);
        const resp = await conn.newSession({ cwd, mcpServers: [] });
        resolvedSessionId = resp.sessionId;
      }
      activeHandlers.delete(acpSessionId);
    }

    if (params.model) {
      try {
        await (conn as any).unstable_setSessionModel({ sessionId: resolvedSessionId, modelId: params.model });
      } catch (err) {
        console.warn('[codexAcp] unstable_setSessionModel failed (non-fatal):', err);
      }
    }

    activeHandlers.set(resolvedSessionId, onEvent);
    try {
      const resp = await conn.prompt({
        sessionId: resolvedSessionId,
        prompt: [{ type: 'text', text: promptText }],
      });
      return { acpSessionId: resolvedSessionId, stopReason: resp.stopReason };
    } catch (err) {
      return { acpSessionId: resolvedSessionId, error: String(err) };
    } finally {
      activeHandlers.delete(resolvedSessionId);
    }
  } finally {
    activeProcesses.delete(novaSessionId);
    killProc();
  }
}

export function cancelCodexAcp(novaSessionId: string): void {
  activeProcesses.get(novaSessionId)?.kill();
}
