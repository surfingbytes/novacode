/**
 * Agent-specific ACP config options (effort, fast mode, etc.) — separate from mode/model.
 */

// node_modules
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type { RequestPermissionRequest, RequestPermissionResponse, SessionConfigOption } from '@agentclientprotocol/sdk';

// classes
import { config } from './config';
import { findConfigOptionByCategory } from './acpSessionHelpers';

// types
import type { AgentType } from '../@types/index';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const SKIP_CATEGORIES = new Set(['mode', 'model']);

export interface AgentConfigSelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface AgentConfigOption {
  id: string;
  label: string;
  description?: string;
  category?: string;
  options: AgentConfigSelectOption[];
  currentValue?: string;
}

const cache = new Map<AgentType, { options: AgentConfigOption[]; fetchedAt: number }>();

function autoApprovePermission(params: RequestPermissionRequest): RequestPermissionResponse {
  const allowOption = params.options.find(
    (o) => o.kind === 'allow_once' || o.kind === 'allow_always'
  );
  if (allowOption) {
    return { outcome: { outcome: 'selected', optionId: allowOption.optionId } };
  }
  return { outcome: { outcome: 'cancelled' } };
}

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

function spawnCommandForAgent(agentType: AgentType): { command: string; args: string[] } | null {
  if (agentType === 'cursor-agent') return { command: config.cursorCommand, args: ['acp'] };
  if (agentType === 'mistral-vibe') return { command: config.vibeAcpCommand, args: [] };
  if (agentType === 'open-code') return { command: config.openCodeAcpCommand, args: ['acp'] };
  if (agentType === 'codex') return { command: config.codexAcpCommand, args: ['acp'] };
  return null;
}

function flattenSelectOptions(
  option: SessionConfigOption & { type: 'select' }
): AgentConfigSelectOption[] {
  const opts = option.options;
  if (!Array.isArray(opts) || opts.length === 0) return [];
  const first = opts[0] as { value?: string; name?: string; options?: Array<{ value: string; name: string; description?: string | null }> };
  if ('value' in first && first.value && first.name) {
    return (opts as Array<{ value: string; name: string; description?: string | null }>).map((o) => ({
      value: o.value,
      label: o.name,
      ...(o.description ? { description: o.description } : {}),
    }));
  }
  return (opts as Array<{ options: Array<{ value: string; name: string; description?: string | null }> }>).flatMap(
    (group) =>
      group.options.map((o) => ({
        value: o.value,
        label: o.name,
        ...(o.description ? { description: o.description } : {}),
      }))
  );
}

function configOptionsFromSession(
  configOptions: SessionConfigOption[] | null | undefined
): AgentConfigOption[] {
  if (!configOptions?.length) return [];

  const result: AgentConfigOption[] = [];
  for (const raw of configOptions) {
    if (raw.type !== 'select') continue;
    const category = raw.category ?? raw.id;
    if (SKIP_CATEGORIES.has(category) || SKIP_CATEGORIES.has(raw.id)) continue;

    const options = flattenSelectOptions(raw as SessionConfigOption & { type: 'select' });
    if (options.length === 0) continue;

    result.push({
      id: raw.id,
      label: raw.name,
      ...(raw.description ? { description: raw.description } : {}),
      ...(raw.category ? { category: raw.category } : {}),
      options,
      ...('currentValue' in raw && typeof raw.currentValue === 'string'
        ? { currentValue: raw.currentValue }
        : {}),
    });
  }
  return result;
}

async function probeAgentConfigOptions(agentType: AgentType): Promise<AgentConfigOption[]> {
  const spawnSpec = spawnCommandForAgent(agentType);
  if (!spawnSpec) return [];

  const env = { ...process.env, ...config.agentEnv() };
  let proc: ChildProcess;
  try {
    proc = spawn(spawnSpec.command, spawnSpec.args, {
      cwd: config.configDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
  } catch {
    return [];
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

    return await app.connectWith(stream, async (ctx) => {
      await ctx.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'nova-code', version: '1.0.0' },
        clientCapabilities: {},
      });
      const resp = await ctx.request(methods.agent.session.new, {
        cwd: config.configDir,
        mcpServers: [],
      });
      return configOptionsFromSession(
        (resp as { configOptions?: SessionConfigOption[] }).configOptions
      );
    });
  } catch {
    return [];
  } finally {
    killProc();
  }
}

export async function getAgentConfigOptions(
  agentType: AgentType
): Promise<{ options: AgentConfigOption[]; fromCache: boolean }> {
  const now = Date.now();
  const cached = cache.get(agentType);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { options: cached.options, fromCache: true };
  }

  const probed = await probeAgentConfigOptions(agentType);
  cache.set(agentType, { options: probed, fetchedAt: now });
  return { options: probed, fromCache: false };
}

/** Merge inbound config_option_update into cached option list. */
export function mergeInboundConfigOptions(
  options: AgentConfigOption[],
  inbound: SessionConfigOption[]
): AgentConfigOption[] {
  const next = [...options];
  for (const raw of inbound) {
    if (raw.type !== 'select') continue;
    const category = raw.category ?? raw.id;
    if (SKIP_CATEGORIES.has(category) || SKIP_CATEGORIES.has(raw.id)) continue;

    const idx = next.findIndex((o) => o.id === raw.id);
    const currentValue =
      'currentValue' in raw && typeof raw.currentValue === 'string' ? raw.currentValue : undefined;
    const flat = flattenSelectOptions(raw as SessionConfigOption & { type: 'select' });

    if (idx >= 0) {
      next[idx] = {
        ...next[idx],
        ...(flat.length > 0 ? { options: flat } : {}),
        ...(currentValue ? { currentValue } : {}),
      };
    } else if (flat.length > 0) {
      next.push({
        id: raw.id,
        label: raw.name,
        ...(raw.description ? { description: raw.description } : {}),
        ...(raw.category ? { category: raw.category } : {}),
        options: flat,
        ...(currentValue ? { currentValue } : {}),
      });
    }
  }
  return next;
}

export { findConfigOptionByCategory };
