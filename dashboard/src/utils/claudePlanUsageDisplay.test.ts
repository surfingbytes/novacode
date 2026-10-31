import { describe, expect, it } from 'vitest';

import {
  formatClaudePlanUsageLabel,
  formatClaudePlanUsageTitle,
  parseClaudeRateLimitMeta
} from './claudePlanUsageDisplay';

const NOW_MS = 1_793_400_000_000;
const NOW_S = NOW_MS / 1000;

describe('claudePlanUsageDisplay', () => {
  it('parses unifiedWindows from the rate-limit meta', () => {
    const windows = parseClaudeRateLimitMeta({
      status: 'allowed',
      rateLimitType: 'seven_day',
      unifiedWindows: {
        five_hour: { utilization: 0.42, resetsAt: NOW_S + 3600, status: 'allowed' },
        seven_day: { utilization: 0.44, resetsAt: NOW_S + 86400 * 3 },
        broken: { resetsAt: 1 }
      }
    });
    expect(windows).toEqual({
      five_hour: { utilization: 0.42, resetsAt: NOW_S + 3600, status: 'allowed' },
      seven_day: { utilization: 0.44, resetsAt: NOW_S + 86400 * 3 }
    });
  });

  it('falls back to the single binding window from older CLIs', () => {
    expect(parseClaudeRateLimitMeta({ rateLimitType: 'five_hour', utilization: 0.9, resetsAt: NOW_S })).toEqual({
      five_hour: { utilization: 0.9, resetsAt: NOW_S }
    });
    expect(parseClaudeRateLimitMeta({ status: 'allowed' })).toBeNull();
    expect(parseClaudeRateLimitMeta(undefined)).toBeNull();
  });

  it('labels the 5h and weekly windows as usage left', () => {
    const usage = {
      windows: {
        five_hour: { utilization: 0.42, resetsAt: NOW_S + 3600 },
        seven_day: { utilization: 0.444, resetsAt: NOW_S + 86400 }
      },
      updatedAt: new Date(NOW_MS).toISOString()
    };
    expect(formatClaudePlanUsageLabel(usage, NOW_MS)).toBe('5h 58% · 7d 56% left');
  });

  it('treats a window past its reset as fully available', () => {
    const usage = {
      windows: { five_hour: { utilization: 0.97, resetsAt: NOW_S - 60 } },
      updatedAt: new Date(NOW_MS).toISOString()
    };
    expect(formatClaudePlanUsageLabel(usage, NOW_MS)).toBe('5h 100% left');
    expect(formatClaudePlanUsageTitle(usage, NOW_MS)).toMatch(/^5-hour limit: 0% used\n/);
  });

  it('returns null when neither header window is known', () => {
    const usage = {
      windows: { seven_day_opus: { utilization: 0.1, resetsAt: null } },
      updatedAt: new Date(NOW_MS).toISOString()
    };
    expect(formatClaudePlanUsageLabel(usage, NOW_MS)).toBeNull();
    expect(formatClaudePlanUsageTitle(usage, NOW_MS)).toContain('Weekly · Opus: 10% used');
  });
});
