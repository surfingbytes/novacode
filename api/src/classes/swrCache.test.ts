import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSwrCache, readSwrDiskCache, writeSwrDiskCache } from './swrCache';

describe('swr disk helpers', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a cache file', () => {
    dir = mkdtempSync(join(tmpdir(), 'swr-disk-'));
    const file = join(dir, 'cache', 'models.json');
    writeSwrDiskCache(file, { value: ['auto'], fetchedAt: 42 });
    expect(readSwrDiskCache<string[]>(file)).toEqual({ value: ['auto'], fetchedAt: 42 });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ value: ['auto'], fetchedAt: 42 });
  });

  it('returns null for missing or invalid files', () => {
    dir = mkdtempSync(join(tmpdir(), 'swr-disk-'));
    expect(readSwrDiskCache(join(dir, 'missing.json'))).toBeNull();
    writeFileSync(join(dir, 'bad.json'), '{', 'utf8');
    expect(readSwrDiskCache(join(dir, 'bad.json'))).toBeNull();
  });
});

describe('createSwrCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('awaits a cold fetch and then serves memory within ttl', async () => {
    let n = 0;
    const cache = createSwrCache({ ttlMs: 10_000, isValid: (v: number) => v > 0 });
    const fetchFresh = async () => ++n;
    expect(await cache.get(fetchFresh)).toEqual({ value: 1, fromCache: false });
    expect(await cache.get(fetchFresh)).toEqual({ value: 1, fromCache: true });
    expect(n).toBe(1);
  });

  it('returns stale immediately after ttl and refreshes in the background', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    let n = 0;
    const cache = createSwrCache({ ttlMs: 1_000, isValid: (v: number) => v > 0 });
    const fetchFresh = async () => ++n;
    await cache.get(fetchFresh);
    vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));
    expect(await cache.get(fetchFresh)).toEqual({ value: 1, fromCache: true });
    await cache.pending();
    expect(await cache.get(fetchFresh)).toEqual({ value: 2, fromCache: true });
    expect(n).toBe(2);
  });

  it('keeps stale when a refresh is invalid', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    let n = 0;
    const cache = createSwrCache({ ttlMs: 1_000, isValid: (v: number) => v === 1 });
    const fetchFresh = async () => ++n;
    await cache.get(fetchFresh);
    vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));
    await cache.get(fetchFresh);
    await cache.pending();
    expect(await cache.get(fetchFresh)).toEqual({ value: 1, fromCache: true });
    expect(n).toBe(2);
  });

  it('hydrates from disk so the first get does not fetch', async () => {
    const cache = createSwrCache({
      ttlMs: 10_000,
      isValid: (v: number) => v > 0,
      loadDisk: () => ({ value: 7, fetchedAt: Date.now() }),
    });
    let fetched = false;
    expect(await cache.get(async () => {
      fetched = true;
      return 1;
    })).toEqual({ value: 7, fromCache: true });
    expect(fetched).toBe(false);
  });
});
