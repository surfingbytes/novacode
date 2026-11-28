/**
 * Claude ACP agent (`@agentclientprotocol/claude-agent-acp`) as a child process. The package only
 * serves ACP over stdio (it no longer exports the agent class), so each Nova session spawns its own
 * `claude-agent-acp` and talks to it through a long-lived SDK client connection.
 */

// node_modules
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { client, methods, ndJsonStream } from '@agentclientprotocol/sdk';
import type {
  ClientContext,
  LoadSessionResponse,
  NewSessionResponse,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk';

// classes
import { childEnv, childProcessFailure } from './childEnv';
import { acpAgent } from './acpSessionHelpers';
import { nodeReadableToWeb, nodeWritableToWeb } from './acpStreams';
import { logger, truncateLogText } from './logger';

/** Raw SDK messages the adapter forwards as `_claude/sdkMessage` extension notifications. */
export const CLAUDE_SDK_MESSAGE_METHOD = '_claude/sdkMessage';

/** What the agent asks of Nova: streaming updates, permissions and raw SDK messages. */
export interface ClaudeAgentCallbacks {
  sessionUpdate(notification: SessionNotification): Promise<void> | void;
  requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse>;
  extNotification(method: string, params: Record<string, unknown>): Promise<void> | void;
}

/** The agent-side requests Nova sends; `dispose` ends the process. */
export interface ClaudeAgent {
  initialize(params: Record<string, unknown>): Promise<unknown>;
  newSession(params: Record<string, unknown>): Promise<NewSessionResponse>;
  resumeSession(params: Record<string, unknown>): Promise<LoadSessionResponse>;
  prompt(params: Record<string, unknown>): Promise<PromptResponse>;
  cancel(params: { sessionId: string }): Promise<void>;
  closeSession(params: { sessionId: string }): Promise<unknown>;
  deleteSession(params: { sessionId: string }): Promise<unknown>;
  setSessionMode(params: { sessionId: string; modeId: string }): Promise<unknown>;
  setSessionConfigOption(params: { sessionId: string; configId: string; value: string }): Promise<unknown>;
  dispose(): Promise<void>;
}

/** Grace period between SIGTERM and SIGKILL when the agent does not exit on its own. */
const KILL_GRACE_MS = 2_000;

function claudeAgentEntry(): string {
  // The package is ESM-only with a restrictive exports map: resolve package.json, then the bin file.
  const manifest = require.resolve('@agentclientprotocol/claude-agent-acp/package.json');
  return join(dirname(manifest), 'dist', 'index.js');
}

/** Spawn a `claude-agent-acp` child and connect to it; requests wait for the connection to open. */
export function spawnClaudeAgent(callbacks: ClaudeAgentCallbacks): ClaudeAgent {
  const proc = spawn(process.execPath, [claudeAgentEntry()], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnv(),
  });
  const spawnFailure = childProcessFailure(proc);
  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) logger.debug({ stderr: truncateLogText(text) }, 'Claude ACP agent stderr');
  });
  const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));

  const parseUnknown = (params: unknown): unknown => params;
  const app = client({ name: 'nova-code' })
    .onNotification(methods.client.session.update, ({ params }) => callbacks.sessionUpdate(params))
    .onRequest(methods.client.session.requestPermission, ({ params }) => callbacks.requestPermission(params))
    .onRequest(methods.client.fs.readTextFile, async () => ({ content: '' }))
    .onRequest(methods.client.fs.writeTextFile, async () => ({}));
  // Extension methods are not in the core method union.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any).onNotification(
    CLAUDE_SDK_MESSAGE_METHOD,
    parseUnknown,
    ({ params }: { params: unknown }) => {
      if (params && typeof params === 'object') {
        return callbacks.extNotification(CLAUDE_SDK_MESSAGE_METHOD, params as Record<string, unknown>);
      }
    }
  );

  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The connection is open for as long as this callback runs: until dispose or process exit.
  const contextReady = new Promise<ClientContext>((resolve, reject) => {
    const stream = ndJsonStream(nodeWritableToWeb(proc.stdin!), nodeReadableToWeb(proc.stdout!));
    const connection = app.connectWith(stream, async (ctx) => {
      resolve(ctx);
      await Promise.race([released, exited]);
    });
    void Promise.race([spawnFailure, connection]).catch(reject);
  });
  // Observed through the requests; a failure with no request pending must not be unhandled.
  contextReady.catch(() => {});

  const call = async <T>(run: (agent: ReturnType<typeof acpAgent>, ctx: ClientContext) => Promise<T>): Promise<T> => {
    const ctx = await contextReady;
    return run(acpAgent(ctx), ctx);
  };

  let disposing: Promise<void> | null = null;
  const dispose = (): Promise<void> => {
    disposing ??= (async () => {
      release();
      if (proc.exitCode === null && proc.signalCode === null) {
        try {
          proc.kill('SIGTERM');
        } catch {
          // already dead
        }
        const killTimer = setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // already dead
          }
        }, KILL_GRACE_MS);
        killTimer.unref();
        await exited;
        clearTimeout(killTimer);
      }
    })();
    return disposing;
  };

  return {
    initialize: (params) => call((_agent, ctx) => ctx.request(methods.agent.initialize, params as never)),
    newSession: (params) =>
      call((_agent, ctx) => ctx.request(methods.agent.session.new, params as never) as Promise<NewSessionResponse>),
    resumeSession: (params) =>
      call(
        (_agent, ctx) => ctx.request(methods.agent.session.resume, params as never) as Promise<LoadSessionResponse>
      ),
    prompt: (params) =>
      call((_agent, ctx) => ctx.request(methods.agent.session.prompt, params as never) as Promise<PromptResponse>),
    cancel: (params) => call((agent) => agent.cancel(params)),
    closeSession: (params) => call((agent) => agent.closeSession(params)),
    deleteSession: (params) => call((agent) => agent.deleteSession(params)),
    setSessionMode: (params) => call((agent) => agent.setSessionMode(params)),
    setSessionConfigOption: (params) => call((agent) => agent.setSessionConfigOption(params)),
    dispose,
  };
}
