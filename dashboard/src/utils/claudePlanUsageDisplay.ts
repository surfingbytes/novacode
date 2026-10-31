/**
 * Claude subscription usage (5-hour / weekly windows) for the session header.
 */

// utils
import { relativeTimeShort } from '@/utils/relativeTime';

// types
import type { ClaudePlanUsage, ClaudePlanUsageWindow } from '@/@types/index';

type PlanWindows = Record<string, ClaudePlanUsageWindow>;

/** Short labels for the header, in display order. */
const HEADER_WINDOWS: Array<[key: string, label: string]> = [
  ['five_hour', '5h'],
  ['seven_day', '7d']
];

const WINDOW_TITLES: Record<string, string> = {
  five_hour: '5-hour limit',
  seven_day: 'Weekly · all models',
  seven_day_opus: 'Weekly · Opus',
  seven_day_sonnet: 'Weekly · Sonnet',
  seven_day_overage_included: 'Weekly · incl. extra usage',
  overage: 'Extra usage'
};

function normalizeWindow(value: unknown): ClaudePlanUsageWindow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const utilization = record['utilization'];
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) return null;
  const resetsAt = record['resetsAt'];
  return {
    utilization,
    resetsAt: typeof resetsAt === 'number' && Number.isFinite(resetsAt) ? resetsAt : null,
    ...(typeof record['status'] === 'string' ? { status: record['status'] } : {})
  };
}

/** Windows from a Claude `usage_update` `_meta["_claude/rateLimit"]` payload. */
export function parseClaudeRateLimitMeta(value: unknown): PlanWindows | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const windows: PlanWindows = {};
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

/** Fraction used, treating a window whose reset time has passed as empty. */
function usedFraction(window: ClaudePlanUsageWindow, nowMs: number): number {
  if (window.resetsAt != null && window.resetsAt * 1000 <= nowMs) return 0;
  return Math.min(1, Math.max(0, window.utilization));
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** "5h 58% · 7d 56% left", or null when neither window is known. */
export function formatClaudePlanUsageLabel(usage: ClaudePlanUsage, nowMs = Date.now()): string | null {
  const parts = HEADER_WINDOWS.flatMap(([key, label]) => {
    const window = usage.windows[key];
    return window ? [`${label} ${percent(1 - usedFraction(window, nowMs))}`] : [];
  });
  return parts.length > 0 ? `${parts.join(' · ')} left` : null;
}

function formatResetTime(resetsAt: number, nowMs: number): string {
  const date = new Date(resetsAt * 1000);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (resetsAt * 1000 - nowMs < 24 * 60 * 60 * 1000) return time;
  return `${date.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

/** Multi-line tooltip: every window with used % and reset time, then freshness. */
export function formatClaudePlanUsageTitle(usage: ClaudePlanUsage, nowMs = Date.now()): string {
  const lines = Object.entries(usage.windows).map(([key, window]) => {
    const title = WINDOW_TITLES[key] ?? key;
    const reset =
      window.resetsAt != null && window.resetsAt * 1000 > nowMs
        ? ` · resets ${formatResetTime(window.resetsAt, nowMs)}`
        : '';
    return `${title}: ${percent(usedFraction(window, nowMs))} used${reset}`;
  });
  lines.push(`Claude subscription usage · updated ${relativeTimeShort(usage.updatedAt)}`);
  return lines.join('\n');
}
