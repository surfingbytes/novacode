/**
 * Probes shared by the agent adapters: a throwaway ACP `session/new` and the `<agent> models` CLI.
 */

// node_modules
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import stripAnsi from 'strip-ansi';
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type { NewSessionResponse, RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';

// classes
import { childEnv, childProcessFailure, execCli } from '../childEnv';
import { config } from '../config';
import { nodeReadableToWeb, nodeWritableToWeb } from '../acpStreams';
import { parseFlatModelsOutput, prettifyId, toModelOption } from './modelOptions';

// types
import type { AgentModelOption, RawAgentModel } from './types';

const execFileAsync = promisify(execFile);

export interface CommandSpec {
  command: string;
  args: string[];
}

export function autoApprovePermission(params: RequestPermissionRequest): RequestPermissionResponse {
  const allowOption = params.options.find(
    (o) => o.kind === 'allow_once' || o.kind === 'allow_always'
  );
  if (allowOption) {
    return { outcome: { outcome: 'selected', optionId: allowOption.optionId } };
  }
  return { outcome: { outcome: 'cancelled' } };
}

/** Spawn the agent, `initialize` + `session/new` in the config dir, kill it. null on any failure. */
export async function probeAcpNewSession(spawnSpec: CommandSpec | null): Promise<NewSessionResponse | null> {
  if (!spawnSpec) return null;

  let proc: ChildProcess;
  let spawnFailure: Promise<never>;
  try {
    proc = spawn(spawnSpec.command, spawnSpec.args, {
      cwd: config.configDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv(),
    });
    spawnFailure = childProcessFailure(proc);
  } catch {
    return null;
  }

  const killProc = () => {
    try {
      proc.kill();
    } catch {
      // already dead
    }
  };

  try {
    const stream = ndJsonStream(nodeWritableToWeb(proc.stdin!), nodeReadableToWeb(proc.stdout!));
    const app = client({ name: 'nova-code' }).onRequest(
      methods.client.session.requestPermission,
      ({ params }) => autoApprovePermission(params)
    );

    return await Promise.race([spawnFailure, app.connectWith(stream, async (ctx) => {
      await ctx.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'nova-code', version: '1.0.0' },
        clientCapabilities: {},
      });
      return (await ctx.request(methods.agent.session.new, {
        cwd: config.configDir,
        mcpServers: [],
      })) as NewSessionResponse;
    })]);
  } catch {
    return null;
  } finally {
    killProc();
  }
}

/**
 * Models endpoint: `<agent> models`, accepting `id - label` lines. Async on purpose: a sync spawn
 * here froze the event loop for seconds on cache miss.
 */
export async function listCliModels(command: CommandSpec): Promise<RawAgentModel[]> {
  try {
    const { stdout, stderr } = await execFileAsync(command.command, command.args, {
      encoding: 'utf8',
      timeout: 15_000,
      cwd: config.configDir,
      env: childEnv()
    });
    const raw = [stdout, stderr].filter(Boolean).join('\n');
    return raw ? parseFlatModelsOutput(raw) : [];
  } catch {
    // Non-zero exit, timeout or missing binary.
    return [];
  }
}

/** Agent options fallback when ACP reports no models: `<agent> models`, bare-id lines only. */
export async function listCliModelIds(command: CommandSpec): Promise<AgentModelOption[]> {
  const result = await execCli(command.command, command.args, { timeoutMs: 15_000 });
  const raw = stripAnsi([result.stdout, result.stderr].filter(Boolean).join('\n'));
  if (result.status !== 0 || !raw) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[a-z0-9][a-z0-9._:/,\-[\]=]*$/i.test(line))
    .map((id) => toModelOption({ id, label: prettifyId(id) }));
}
