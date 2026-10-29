// node_modules
import stripAnsi from 'strip-ansi';

// classes
import { execCli } from './childEnv';
import { config } from './config';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface CursorModelOption {
  id: string;
  label: string;
  current?: boolean;
}

let cache: { models: CursorModelOption[]; fetchedAt: number } | null = null;
let inFlight: Promise<CursorModelOption[]> | null = null;

/**
 * Parse stdout from `cursor-agent models` into a list of { id, label }.
 * Format:
 *   Available models
 *   auto - Auto  (current)
 *   composer-1.5 - Composer 1.5
 *   Tip: use --model <id> ...
 */
function parseModelsOutput(stdout: string): CursorModelOption[] {
  const lines = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  const result: CursorModelOption[] = [];

  for (const line of lines) {
    if (line === 'Available models' || line.startsWith('Tip:')) {
      continue;
    }
    const dashIdx = line.indexOf(' - ');
    if (dashIdx === -1) {
      continue;
    }
    const id = line.slice(0, dashIdx).trim();
    let label = line.slice(dashIdx + 3).trim();
    if (!id) {
      continue;
    }
    const current = /\s*\((current|default)\)\s*$/i.test(label);
    // Strip " (current)" or " (default)" from label for display
    label = label.replace(/\s*\((current|default)\)\s*$/i, '').trim();
    result.push({ id, label, ...(current ? { current: true } : {}) });
  }

  return result;
}

/**
 * Fetch available Cursor agent models by running `cursor-agent models`.
 * Results are cached for 4 hours.
 */
export async function getCursorModels(): Promise<{ models: CursorModelOption[]; fromCache: boolean }> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { models: cache.models, fromCache: true };
  }
  inFlight ??= fetchCursorModels().finally(() => {
    inFlight = null;
  });
  return { models: await inFlight, fromCache: false };
}

async function fetchCursorModels(): Promise<CursorModelOption[]> {
  const result = await execCli(config.cursorCommand, ['models'], { timeoutMs: 15_000 });

  const raw = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const out = stripAnsi(raw);
  const models = result.status === 0 && out ? parseModelsOutput(out) : [];

  // If we got no models from CLI, provide a minimal default so the UI still works
  const fallback: CursorModelOption[] = [{ id: 'auto', label: 'Auto' }];
  const toCache = models.length > 0 ? models : fallback;
  cache = { models: toCache, fetchedAt: Date.now() };
  return toCache;
}
