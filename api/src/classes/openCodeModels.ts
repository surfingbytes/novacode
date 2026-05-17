import { spawnSync } from 'node:child_process';
import { config } from './config';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

export interface OpenCodeModelOption {
  id: string;
  label: string;
}

let cache: { models: OpenCodeModelOption[]; fetchedAt: number } | null = null;

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

export function getOpenCodeModels(): { models: OpenCodeModelOption[]; fromCache: boolean } {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { models: cache.models, fromCache: true };
  }

  const env = { ...process.env, ...config.agentEnv() };
  console.log('[opencode-models] OPENCODE_HOME:', env['OPENCODE_HOME']);
  console.log('[opencode-models] HOME:', env['HOME']);

  const result = spawnSync(config.openCodeCommand, ['models'], {
    encoding: 'utf8',
    timeout: 15_000,
    cwd: config.configDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  console.log('[opencode-models] status:', result.status, 'signal:', result.signal);
  console.log('[opencode-models] stdout:', result.stdout?.slice(0, 500));
  console.log('[opencode-models] stderr:', result.stderr?.slice(0, 500));
  if (result.error) console.log('[opencode-models] error:', result.error.message);

  const raw = (result.stdout ?? '').trim();
  const models = result.status === 0 && raw ? parseModelsOutput(raw) : [];
  const fallback: OpenCodeModelOption[] = [{ id: 'opencode/big-pickle', label: 'opencode/big-pickle' }];
  const toCache = models.length > 0 ? models : fallback;
  cache = { models: toCache, fetchedAt: now };
  return { models: toCache, fromCache: false };
}
