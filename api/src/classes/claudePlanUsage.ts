// node_modules
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// classes
import { config } from './config';
import { logger } from './logger';

// types
import type { ClaudePlanUsage, ClaudePlanUsageWindow } from '../@types/index';

/** Kept on disk so the header has usage right after an API restart, before the next turn. */
const PLAN_USAGE_FILE = '.config/novacode/claude-plan-usage.json';

let latest: ClaudePlanUsage | null | undefined;

function planUsagePath(): string {
  return join(config.configDir, PLAN_USAGE_FILE);
}

function normalizeWindow(value: unknown): ClaudePlanUsageWindow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const utilization = record['utilization'];
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) return null;
  const resetsAt = record['resetsAt'];
  const window: ClaudePlanUsageWindow = {
    utilization,
    resetsAt: typeof resetsAt === 'number' && Number.isFinite(resetsAt) ? resetsAt : null
  };
  if (typeof record['status'] === 'string') window.status = record['status'];
  return window;
}

/** Windows from a `_claude/rateLimit` payload, or null when it carries none. */
function normalizeClaudeRateLimit(value: unknown): Record<string, ClaudePlanUsageWindow> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const windows: Record<string, ClaudePlanUsageWindow> = {};
  const unified = record['unifiedWindows'];
  if (unified && typeof unified === 'object' && !Array.isArray(unified)) {
    for (const [key, raw] of Object.entries(unified as Record<string, unknown>)) {
      const window = normalizeWindow(raw);
      if (window) windows[key] = window;
    }
  }
  // Older CLIs only report the window that is currently binding.
  if (Object.keys(windows).length === 0 && typeof record['rateLimitType'] === 'string') {
    const window = normalizeWindow(record);
    if (window) windows[record['rateLimitType']] = window;
  }
  return Object.keys(windows).length > 0 ? windows : null;
}

/** Parse a Claude ACP stream line for plan usage. Returns null for any other event. */
export function parseClaudePlanUsageLine(line: string): Record<string, ClaudePlanUsageWindow> | null {
  if (!line.includes('_claude/rateLimit')) return null;
  try {
    const parsed = JSON.parse(line) as { update?: { sessionUpdate?: string; _meta?: Record<string, unknown> } };
    if (parsed.update?.sessionUpdate !== 'usage_update') return null;
    return normalizeClaudeRateLimit(parsed.update._meta?.['_claude/rateLimit']);
  } catch {
    return null;
  }
}

export function getClaudePlanUsage(): ClaudePlanUsage | null {
  if (latest === undefined) {
    latest = null;
    try {
      const path = planUsagePath();
      if (existsSync(path)) {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as { windows?: unknown; updatedAt?: unknown };
        const windows = normalizeClaudeRateLimit({ unifiedWindows: parsed.windows });
        if (windows && typeof parsed.updatedAt === 'string') {
          latest = { windows, updatedAt: parsed.updatedAt };
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to read Claude plan usage');
    }
  }
  return latest;
}

export function recordClaudePlanUsage(windows: Record<string, ClaudePlanUsageWindow>): void {
  const previous = getClaudePlanUsage();
  const usage: ClaudePlanUsage = { windows, updatedAt: new Date().toISOString() };
  latest = usage;
  if (previous && JSON.stringify(previous.windows) === JSON.stringify(windows)) return;
  try {
    const path = planUsagePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(usage));
  } catch (err) {
    logger.warn({ err }, 'Failed to save Claude plan usage');
  }
}

/** Test hook: forget the cached value so the next read goes to disk. */
export function resetClaudePlanUsageCache(): void {
  latest = undefined;
}
