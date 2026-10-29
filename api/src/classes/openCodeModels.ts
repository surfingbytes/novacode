import { execCli } from './childEnv';
import { config } from './config';
import { logger } from './logger';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

export interface OpenCodeModelOption {
  id: string;
  label: string;
}

let cache: { models: OpenCodeModelOption[]; fetchedAt: number } | null = null;
let inFlight: Promise<OpenCodeModelOption[]> | null = null;

function parseModelsOutput(stdout: string): OpenCodeModelOption[] {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((id) => ({ id, label: id }));
}

export function clearOpenCodeModelsCache(): void {
  cache = null;
}

export async function getOpenCodeModels(): Promise<{ models: OpenCodeModelOption[]; fromCache: boolean }> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { models: cache.models, fromCache: true };
  }
  inFlight ??= fetchOpenCodeModels().finally(() => {
    inFlight = null;
  });
  return { models: await inFlight, fromCache: false };
}

async function fetchOpenCodeModels(): Promise<OpenCodeModelOption[]> {
  const result = await execCli(config.openCodeCommand, ['models'], { timeoutMs: 15_000 });
  if (result.error) {
    logger.warn({ error: result.error.message, stderr: result.stderr.slice(0, 500) }, 'opencode models listing failed');
  }

  const raw = result.stdout.trim();
  const models = result.status === 0 && raw ? parseModelsOutput(raw) : [];
  const fallback: OpenCodeModelOption[] = [{ id: 'opencode/big-pickle', label: 'opencode/big-pickle' }];
  const toCache = models.length > 0 ? models : fallback;
  cache = { models: toCache, fetchedAt: Date.now() };
  return toCache;
}
