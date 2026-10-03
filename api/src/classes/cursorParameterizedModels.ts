/**
 * Cursor ACP parameterized model catalog.
 *
 * With `clientCapabilities._meta.parameterizedModelPicker`, cursor-agent exposes base
 * models (e.g. `gpt-5.6-sol`) plus per-model params like `context=272k|1m`. The CLI
 * `models` list is variants-mode only and currently omits the cheaper default windows.
 */

// node_modules
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type { RequestPermissionRequest, RequestPermissionResponse, SessionConfigOption } from '@agentclientprotocol/sdk';

// classes
import { config } from './config';
import type { CursorModelOption } from './cursorModels';
import { createSwrCache, readSwrDiskCache, writeSwrDiskCache } from './swrCache';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 120_000;
const PARALLEL_WORKERS = 6;
const THINKING_PARAM_IDS = ['reasoning', 'reasoning_effort', 'effort', 'thinking'] as const;
const CONTEXT_PARAM_ID = 'context';
const FAST_PARAM_ID = 'fast';

type SelectOption = { value: string; name: string };
type ParamValues = { id: string; values: string[]; currentValue?: string };

function diskPath(): string {
  return join(config.configDir, 'cache', 'cursor-parameterized-models.json');
}

const catalogCache = createSwrCache<CursorModelOption[]>({
  ttlMs: CACHE_TTL_MS,
  isValid: (models) => models.length > 1,
  loadDisk: () => readSwrDiskCache<CursorModelOption[]>(diskPath()),
  saveDisk: (entry) => writeSwrDiskCache(diskPath(), entry),
});

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
        try {
          controller.enqueue(typeof chunk === 'string' ? Buffer.from(chunk) : new Uint8Array(chunk));
        } catch {
          // stream already closed
        }
      });
      readable.on('end', () => {
        try {
          controller.close();
        } catch {
          // stream already closed
        }
      });
      readable.on('error', () => {
        try {
          controller.close();
        } catch {
          // stream already closed
        }
      });
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

function flattenSelectOptions(option: SessionConfigOption & { type: 'select' }): SelectOption[] {
  const opts = option.options;
  if (!Array.isArray(opts) || opts.length === 0) return [];
  const first = opts[0] as {
    value?: string;
    name?: string;
    options?: Array<{ value: string; name: string }>;
  };
  if ('value' in first && first.value && first.name) {
    return (opts as Array<{ value: string; name: string }>).map((o) => ({
      value: o.value,
      name: o.name,
    }));
  }
  return (opts as Array<{ options: Array<{ value: string; name: string }> }>).flatMap((group) =>
    group.options.map((o) => ({ value: o.value, name: o.name }))
  );
}

function readParamValues(configOptions: SessionConfigOption[] | null | undefined): ParamValues[] {
  const result: ParamValues[] = [];
  for (const raw of configOptions ?? []) {
    if (raw.type !== 'select') continue;
    const category = raw.category ?? raw.id;
    if (category === 'mode' || raw.id === 'mode' || category === 'model' || raw.id === 'model') {
      continue;
    }
    const values = flattenSelectOptions(raw).map((o) => o.value).filter(Boolean);
    if (values.length === 0) continue;
    result.push({
      id: raw.id,
      values,
      ...('currentValue' in raw && typeof raw.currentValue === 'string'
        ? { currentValue: raw.currentValue }
        : {}),
    });
  }
  return result;
}

function findModelOption(
  configOptions: SessionConfigOption[] | null | undefined
): (SessionConfigOption & { type: 'select' }) | null {
  const match = configOptions?.find((o) => o.category === 'model' || o.id === 'model') ?? null;
  if (!match || match.type !== 'select') return null;
  return match;
}

/** Stable param order so generated ids match across refreshes. */
function sortParamEntries(params: Record<string, string>): Array<[string, string]> {
  const priority = (key: string): number => {
    if (key === CONTEXT_PARAM_ID) return 0;
    if ((THINKING_PARAM_IDS as readonly string[]).includes(key)) return 1;
    if (key === FAST_PARAM_ID) return 2;
    return 3;
  };
  return Object.entries(params).sort((a, b) => {
    const rank = priority(a[0]) - priority(b[0]);
    return rank || a[0].localeCompare(b[0]);
  });
}

export function buildParameterizedModelId(baseId: string, params: Record<string, string>): string {
  const entries = sortParamEntries(params).filter(([, value]) => value !== undefined && value !== '');
  if (entries.length === 0) return baseId;
  return `${baseId}[${entries.map(([key, value]) => `${key}=${value}`).join(',')}]`;
}

export function expandParameterizedModelVariants(
  baseId: string,
  label: string,
  params: ParamValues[],
  current = false
): CursorModelOption[] {
  if (params.length === 0) {
    return [{ id: baseId, label, ...(current ? { current: true } : {}) }];
  }

  let combos: Array<Record<string, string>> = [{}];
  for (const param of params) {
    const next: Array<Record<string, string>> = [];
    for (const combo of combos) {
      for (const value of param.values) {
        next.push({ ...combo, [param.id]: value });
      }
    }
    combos = next;
  }

  const defaultParams: Record<string, string> = {};
  for (const param of params) {
    defaultParams[param.id] = param.currentValue && param.values.includes(param.currentValue)
      ? param.currentValue
      : param.values[0]!;
  }
  const defaultId = buildParameterizedModelId(baseId, defaultParams);

  return combos.map((combo) => {
    const id = buildParameterizedModelId(baseId, combo);
    return {
      id,
      label,
      ...(current && id === defaultId ? { current: true } : {}),
    };
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function chunkArray<T>(items: T[], chunkCount: number): T[][] {
  const chunks: T[][] = Array.from({ length: Math.max(1, chunkCount) }, () => []);
  items.forEach((item, index) => {
    chunks[index % chunks.length]!.push(item);
  });
  return chunks.filter((chunk) => chunk.length > 0);
}

async function withAcpSession<T>(
  run: (ctx: {
    request: (method: string, params?: unknown) => Promise<unknown>;
  }) => Promise<T>
): Promise<T> {
  let proc: ChildProcess;
  try {
    proc = spawn(config.cursorCommand, ['acp'], {
      cwd: config.configDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...config.agentEnv() },
    });
  } catch (err) {
    throw err;
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
        clientCapabilities: {
          _meta: { parameterizedModelPicker: true },
        },
      });
      return run(ctx);
    });
  } finally {
    killProc();
  }
}

async function probeModelParams(
  modelIds: string[]
): Promise<Map<string, ParamValues[]>> {
  if (modelIds.length === 0) return new Map();

  return withAcpSession(async (ctx) => {
    const session = (await ctx.request(methods.agent.session.new, {
      cwd: config.configDir,
      mcpServers: [],
    })) as { sessionId: string; configOptions?: SessionConfigOption[] };

    const modelOption = findModelOption(session.configOptions);
    if (!modelOption) return new Map();

    const paramsByModel = new Map<string, ParamValues[]>();
    const currentModelId =
      'currentValue' in modelOption && typeof modelOption.currentValue === 'string'
        ? modelOption.currentValue
        : undefined;
    if (currentModelId && modelIds.includes(currentModelId)) {
      paramsByModel.set(currentModelId, readParamValues(session.configOptions));
    }

    for (const modelId of modelIds) {
      if (paramsByModel.has(modelId)) continue;
      try {
        const updated = (await ctx.request(methods.agent.session.setConfigOption, {
          sessionId: session.sessionId,
          configId: modelOption.id,
          value: modelId,
        })) as { configOptions?: SessionConfigOption[] };
        paramsByModel.set(modelId, readParamValues(updated.configOptions));
      } catch {
        paramsByModel.set(modelId, []);
      }
    }

    return paramsByModel;
  });
}

async function probeParameterizedModels(): Promise<CursorModelOption[]> {
  try {
    const bootstrap = await withAcpSession(async (ctx) => {
      const session = (await ctx.request(methods.agent.session.new, {
        cwd: config.configDir,
        mcpServers: [],
      })) as { sessionId: string; configOptions?: SessionConfigOption[] };

      const modelOption = findModelOption(session.configOptions);
      if (!modelOption) {
        return { baseModels: [] as SelectOption[], currentModelId: undefined as string | undefined, currentParams: [] as ParamValues[] };
      }

      const baseModels = flattenSelectOptions(modelOption);
      const currentModelId =
        'currentValue' in modelOption && typeof modelOption.currentValue === 'string'
          ? modelOption.currentValue
          : undefined;

      return {
        baseModels,
        currentModelId,
        currentParams: readParamValues(session.configOptions),
      };
    });

    if (bootstrap.baseModels.length === 0) return [];

    const paramsByModel = new Map<string, ParamValues[]>();
    if (bootstrap.currentModelId) {
      paramsByModel.set(bootstrap.currentModelId, bootstrap.currentParams);
    }

    const remaining = bootstrap.baseModels
      .map((model) => model.value)
      .filter((id) => id && id !== 'auto' && !paramsByModel.has(id));

    const chunks = chunkArray(remaining, PARALLEL_WORKERS);
    const probed = await Promise.all(chunks.map((chunk) => probeModelParams(chunk).catch(() => new Map())));
    for (const map of probed) {
      for (const [id, params] of map) {
        paramsByModel.set(id, params);
      }
    }

    const expanded: CursorModelOption[] = [{ id: 'auto', label: 'Auto' }];
    for (const model of bootstrap.baseModels) {
      if (model.value === 'auto') continue;
      expanded.push(
        ...expandParameterizedModelVariants(
          model.value,
          model.name || model.value,
          paramsByModel.get(model.value) ?? [],
          model.value === bootstrap.currentModelId
        )
      );
    }
    return expanded;
  } catch {
    return [];
  }
}

/**
 * Prefer ACP parameterized catalog (includes default context windows like 272k).
 * Falls back to empty so callers can use the CLI variants list.
 */
async function fetchParameterizedModels(): Promise<CursorModelOption[]> {
  return withTimeout(
    probeParameterizedModels(),
    PROBE_TIMEOUT_MS,
    'parameterized cursor models probe'
  ).catch(() => [] as CursorModelOption[]);
}

export async function getParameterizedCursorModels(): Promise<{
  models: CursorModelOption[];
  fromCache: boolean;
}> {
  const { value, fromCache } = await catalogCache.get(fetchParameterizedModels);
  return { models: value, fromCache };
}

export function resetParameterizedCursorModelsCache(): void {
  catalogCache.reset();
}
