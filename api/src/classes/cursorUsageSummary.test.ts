import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildWorkosSessionCookie,
  clearCursorUsageSummaryCache,
  getCursorUsageSummary,
  parseUsageSummaryJson,
  userIdFromAccessToken
} from './cursorUsageSummary';

function makeJwt(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub })).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('cursorUsageSummary', () => {
  let configDir: string;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'cursor-usage-summary-'));
    clearCursorUsageSummaryCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearCursorUsageSummaryCache();
    rmSync(configDir, { recursive: true, force: true });
  });

  it('extracts user id and builds session cookie', () => {
    const token = makeJwt('auth0|user_ABC');
    expect(userIdFromAccessToken(token)).toBe('user_ABC');
    expect(buildWorkosSessionCookie(token)).toBe(
      `WorkosCursorSessionToken=user_ABC::${token}`
    );
  });

  it('parses individual overall + team on-demand buckets', () => {
    const parsed = parseUsageSummaryJson({
      billingCycleStart: '2026-10-01T00:00:00.000Z',
      billingCycleEnd: '2026-11-01T00:00:00.000Z',
      membershipType: 'enterprise',
      limitType: 'team',
      isUnlimited: false,
      individualUsage: {
        overall: { enabled: true, used: 1246, limit: 6000, remaining: 4754 }
      },
      teamUsage: {
        onDemand: { enabled: true, used: 0, limit: 3000, remaining: 3000 }
      }
    });
    expect(parsed?.individual).toEqual({
      enabled: true,
      usedCents: 1246,
      limitCents: 6000,
      remainingCents: 4754
    });
    expect(parsed?.teamOnDemand).toEqual({
      enabled: true,
      usedCents: 0,
      limitCents: 3000,
      remainingCents: 3000
    });
  });

  it('returns unauthenticated when auth.json is missing', async () => {
    expect(await getCursorUsageSummary(configDir)).toEqual({
      authenticated: false,
      available: false
    });
  });

  it('fetches and caches usage-summary with login token', async () => {
    const token = makeJwt('auth0|user_01TEST');
    const authDir = join(configDir, '.config', 'cursor');
    mkdirSync(authDir, { recursive: true });
    writeFileSync(join(authDir, 'auth.json'), JSON.stringify({ accessToken: token }), 'utf8');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        billingCycleStart: '2026-10-01T00:00:00.000Z',
        billingCycleEnd: '2026-11-01T00:00:00.000Z',
        membershipType: 'enterprise',
        individualUsage: {
          overall: { enabled: true, used: 1246, limit: 6000, remaining: 4754 }
        }
      })
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const first = await getCursorUsageSummary(configDir);
    expect(first.available).toBe(true);
    expect(first.individual?.remainingCents).toBe(4754);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(init.headers.Cookie).toContain('WorkosCursorSessionToken=user_01TEST::');

    const second = await getCursorUsageSummary(configDir);
    expect(second.available).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
