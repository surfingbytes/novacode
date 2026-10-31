import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { config } from './config';
import {
  getClaudePlanUsage,
  parseClaudePlanUsageLine,
  recordClaudePlanUsage,
  resetClaudePlanUsageCache
} from './claudePlanUsage';

function usageLine(meta: Record<string, unknown>): string {
  return JSON.stringify({
    sessionId: 's1',
    update: { sessionUpdate: 'usage_update', used: 10, size: 100, _meta: meta }
  });
}

describe('claudePlanUsage', () => {
  let dir: string;
  let originalConfigDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claude-plan-usage-'));
    originalConfigDir = config.configDir;
    (config as { configDir: string }).configDir = dir;
    resetClaudePlanUsageCache();
  });

  afterEach(() => {
    (config as { configDir: string }).configDir = originalConfigDir;
    resetClaudePlanUsageCache();
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses unified windows from a Claude usage_update line', () => {
    const line = usageLine({
      '_claude/rateLimit': {
        status: 'allowed',
        rateLimitType: 'seven_day',
        unifiedWindows: {
          five_hour: { utilization: 0, resetsAt: 1793448000, status: 'allowed' },
          seven_day: { utilization: 0.41, resetsAt: 1793869200, status: 'allowed' }
        }
      }
    });
    expect(parseClaudePlanUsageLine(line)).toEqual({
      five_hour: { utilization: 0, resetsAt: 1793448000, status: 'allowed' },
      seven_day: { utilization: 0.41, resetsAt: 1793869200, status: 'allowed' }
    });
  });

  it('ignores lines without plan usage', () => {
    expect(parseClaudePlanUsageLine(usageLine({}))).toBeNull();
    expect(parseClaudePlanUsageLine('{"update":{"sessionUpdate":"agent_message_chunk"}}')).toBeNull();
    expect(parseClaudePlanUsageLine('not json _claude/rateLimit')).toBeNull();
  });

  it('keeps the latest usage across a restart', () => {
    expect(getClaudePlanUsage()).toBeNull();
    recordClaudePlanUsage({ five_hour: { utilization: 0.3, resetsAt: 1793448000 } });
    resetClaudePlanUsageCache();
    expect(getClaudePlanUsage()?.windows).toEqual({ five_hour: { utilization: 0.3, resetsAt: 1793448000 } });
  });
});
