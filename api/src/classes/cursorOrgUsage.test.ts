import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCursorOrgApiCredentials,
  clearCursorPooledUsageCache,
  getCursorOrgApiStatus,
  getCursorPooledUsage,
  setCursorOrgApiCredentials
} from './cursorOrgUsage';

describe('cursorOrgUsage', () => {
  let configDir: string;
  const originalFetch = globalThis.fetch;
  let savedKey: string | undefined;
  let savedOrg: string | undefined;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'cursor-org-usage-'));
    clearCursorPooledUsageCache();
    savedKey = process.env['CURSOR_ORG_API_KEY'];
    savedOrg = process.env['CURSOR_ORG_ID'];
    delete process.env['CURSOR_ORG_API_KEY'];
    delete process.env['CURSOR_ORG_ID'];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearCursorPooledUsageCache();
    rmSync(configDir, { recursive: true, force: true });
    if (savedKey === undefined) delete process.env['CURSOR_ORG_API_KEY'];
    else process.env['CURSOR_ORG_API_KEY'] = savedKey;
    if (savedOrg === undefined) delete process.env['CURSOR_ORG_ID'];
    else process.env['CURSOR_ORG_ID'] = savedOrg;
  });

  it('reports unconfigured when nothing is set', () => {
    expect(getCursorOrgApiStatus(configDir)).toEqual({
      configured: false,
      source: null,
      organizationId: null
    });
  });

  it('persists file credentials and prefers env when both exist', () => {
    setCursorOrgApiCredentials(configDir, 'file-key', 'org_file');
    expect(getCursorOrgApiStatus(configDir)).toEqual({
      configured: true,
      source: 'file',
      organizationId: 'org_file'
    });

    process.env['CURSOR_ORG_API_KEY'] = 'env-key';
    process.env['CURSOR_ORG_ID'] = 'org_env';
    expect(getCursorOrgApiStatus(configDir)).toEqual({
      configured: true,
      source: 'env',
      organizationId: 'org_env'
    });
  });

  it('clears file credentials', () => {
    setCursorOrgApiCredentials(configDir, 'file-key', 'org_file');
    clearCursorOrgApiCredentials(configDir);
    expect(getCursorOrgApiStatus(configDir).configured).toBe(false);
  });

  it('fetches and caches pooled usage', async () => {
    setCursorOrgApiCredentials(configDir, 'crsr_test', 'org_abc');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        pool: {
          limitCents: 6000,
          usedCents: 1246,
          remainingCents: 4754,
          contractStartDate: '2026-10-01T00:00:00.000Z',
          contractEndDate: '2026-11-01T00:00:00.000Z'
        },
        teams: []
      })
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const first = await getCursorPooledUsage(configDir);
    expect(first.available).toBe(true);
    expect(first.pool).toEqual({
      limitCents: 6000,
      usedCents: 1246,
      remainingCents: 4754,
      contractStartDate: '2026-10-01T00:00:00.000Z',
      contractEndDate: '2026-11-01T00:00:00.000Z'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await getCursorPooledUsage(configDir);
    expect(second.available).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns configured-but-unavailable on API error', async () => {
    setCursorOrgApiCredentials(configDir, 'bad-key', 'org_abc');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => ''
    }) as unknown as typeof fetch;

    const result = await getCursorPooledUsage(configDir);
    expect(result).toMatchObject({
      configured: true,
      available: false,
      error: 'Invalid Organization API key'
    });
  });
});
