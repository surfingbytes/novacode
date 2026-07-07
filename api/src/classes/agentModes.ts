// node_modules
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';

// classes
import { config } from './config';

// types
import type { AgentType } from '../@types/index';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
export const MODE_SENTINEL = 'default';

export interface AgentModeOption {
  id: string;
  label: string;
  description?: string;
  current?: boolean;
}

const STATIC_AGENT_MODES: Record<AgentType, AgentModeOption[]> = {
  'cursor-agent': [
    { id: MODE_SENTINEL, label: 'Default', description: 'Use agent default mode' },
    { id: 'agent', label: 'Agent', description: 'Full tool access' },
    { id: 'plan', label: 'Plan', description: 'Planning, read-only' },
    { id: 'ask', label: 'Ask', description: 'Q&A, read-only' },
  ],
  claude: [
    { id: MODE_SENTINEL, label: 'Default', description: 'Use agent default mode' },
    { id: 'default', label: 'Manual', description: 'Standard permissions' },
    { id: 'acceptEdits', label: 'Accept Edits', description: 'Auto-accept file edits' },
    { id: 'plan', label: 'Plan', description: 'Planning only' },
  ],
  'mistral-vibe': [
    { id: MODE_SENTINEL, label: 'Default', description: 'Use agent default mode' },
    { id: 'default', label: 'Default', description: 'Ask before tools' },
    { id: 'plan', label: 'Plan', description: 'Read-only planning' },
    { id: 'accept-edits', label: 'Accept Edits', description: 'Auto-accept file edits' },
    { id: 'auto-approve', label: 'Auto Approve', description: 'Auto-approve all tools' },
  ],
  'open-code': [
    { id: MODE_SENTINEL, label: 'Default', description: 'Use agent default mode' },
    { id: 'build', label: 'Build', description: 'Full development access' },
    { id: 'plan', label: 'Plan', description: 'Analysis and planning only' },
  ],
  codex: [
    { id: MODE_SENTINEL, label: 'Default', description: 'Use agent default mode' },
    { id: 'read-only', label: 'Read Only', description: 'No file changes' },
    { id: 'plan', label: 'Plan', description: 'Plan before editing' },
    { id: 'auto', label: 'Auto Edit', description: 'Balanced approvals' },
    { id: 'full-access', label: 'Full Access', description: 'Full tool access' },
  ],
};

const cache = new Map<AgentType, { modes: AgentModeOption[]; fetchedAt: number }>();

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

function modesFromSessionResponse(
  modes: { currentModeId: string; availableModes: Array<{ id: string; name: string; description?: string | null }> } | null | undefined,
  configOptions: Array<{ id: string; name: string; description?: string | null; category?: string | null; type: string; options?: unknown; currentValue?: string }> | null | undefined
): AgentModeOption[] {
  const discovered: AgentModeOption[] = [];
  const currentModeId = modes?.currentModeId;

  if (modes?.availableModes?.length) {
    for (const mode of modes.availableModes) {
      discovered.push({
        id: mode.id,
        label: mode.name,
        ...(mode.description ? { description: mode.description } : {}),
        ...(currentModeId === mode.id ? { current: true } : {}),
      });
    }
  }

  const modeConfig = configOptions?.find((o) => o.category === 'mode' || o.id === 'mode');
  if (modeConfig?.type === 'select' && Array.isArray(modeConfig.options)) {
    const flat = modeConfig.options as Array<{ value?: string; name?: string; description?: string | null; options?: Array<{ value: string; name: string; description?: string | null }> }>;
    for (const entry of flat) {
      if (entry.value && entry.name) {
        discovered.push({
          id: entry.value,
          label: entry.name,
          ...(entry.description ? { description: entry.description } : {}),
          ...(modeConfig.currentValue === entry.value || currentModeId === entry.value ? { current: true } : {}),
        });
      } else if (entry.options) {
        for (const nested of entry.options) {
          discovered.push({
            id: nested.value,
            label: nested.name,
            ...(nested.description ? { description: nested.description } : {}),
            ...(modeConfig.currentValue === nested.value || currentModeId === nested.value ? { current: true } : {}),
          });
        }
      }
    }
  }

  if (discovered.length === 0) return [];

  const deduped = new Map<string, AgentModeOption>();
  for (const mode of discovered) {
    const existing = deduped.get(mode.id);
    if (!existing || mode.current) deduped.set(mode.id, mode);
  }
  const unique = [...deduped.values()];

  const hasSentinel = unique.some((m) => m.id === MODE_SENTINEL);
  const withSentinel = hasSentinel
    ? unique
    : [{ id: MODE_SENTINEL, label: 'Default', description: 'Use agent default mode' }, ...unique];

  if (!withSentinel.some((m) => m.current) && currentModeId) {
    const match = withSentinel.find((m) => m.id === currentModeId);
    if (match) match.current = true;
  }

  return withSentinel;
}

async function probeAgentModes(agentType: AgentType): Promise<AgentModeOption[]> {
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
      return modesFromSessionResponse(
        (resp as { modes?: Parameters<typeof modesFromSessionResponse>[0] }).modes,
        (resp as { configOptions?: Parameters<typeof modesFromSessionResponse>[1] }).configOptions
      );
    });
  } catch {
    return [];
  } finally {
    killProc();
  }
}

export async function getAgentModes(agentType: AgentType): Promise<{ modes: AgentModeOption[]; fromCache: boolean }> {
  const now = Date.now();
  const cached = cache.get(agentType);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { modes: cached.modes, fromCache: true };
  }

  const probed = await probeAgentModes(agentType);
  const modes = probed.length > 0 ? probed : (STATIC_AGENT_MODES[agentType] ?? [{ id: MODE_SENTINEL, label: 'Default' }]);
  cache.set(agentType, { modes, fetchedAt: now });
  return { modes, fromCache: false };
}

/** UI value: show ACP-reported current mode when DB stores the sentinel. */
export function resolveDisplayModeId(storedMode: string, modes: AgentModeOption[]): string {
  if (storedMode !== MODE_SENTINEL) return storedMode;
  return modes.find((m) => m.current)?.id ?? MODE_SENTINEL;
}
