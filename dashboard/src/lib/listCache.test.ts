// @vitest-environment jsdom

// node_modules
import { beforeEach, describe, expect, it } from 'vitest';

// lib
import { clearListCaches, readListCache, writeListCache } from '@/lib/listCache';

describe('listCache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a list', () => {
    writeListCache('workspaces', [{ id: 'a' }]);

    expect(readListCache('workspaces')).toEqual([{ id: 'a' }]);
    expect(readListCache('sessions')).toBeNull();
  });

  it('removes the entry for an empty list so a cold start shows the loading state', () => {
    writeListCache('sessions', [{ id: 'a' }]);
    writeListCache('sessions', []);

    expect(readListCache('sessions')).toBeNull();
  });

  it('drops an oversized list instead of keeping a stale one', () => {
    writeListCache('sessions', [{ id: 'a' }]);
    writeListCache('sessions', [{ text: 'x'.repeat(1_000_001) }]);

    expect(readListCache('sessions')).toBeNull();
  });

  it('ignores corrupt or old-version payloads', () => {
    localStorage.setItem('nova:listCache:workspaces', '{not json');
    localStorage.setItem('nova:listCache:sessions', JSON.stringify({ version: 0, items: [{ id: 'a' }] }));

    expect(readListCache('workspaces')).toBeNull();
    expect(readListCache('sessions')).toBeNull();
  });

  it('clears both lists', () => {
    writeListCache('workspaces', [{ id: 'a' }]);
    writeListCache('sessions', [{ id: 'b' }]);
    clearListCaches();

    expect(readListCache('workspaces')).toBeNull();
    expect(readListCache('sessions')).toBeNull();
  });
});
