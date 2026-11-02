/**
 * Last known workspace / session lists (localStorage) — lets the sidebar and
 * home render instantly on a cold start while the fresh lists load. Callers
 * that need fresh data still await the real fetch.
 *
 * Best-effort like sessionCache: oversized lists are not stored and all
 * storage failures are swallowed.
 */

// lib
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/lib/safeLocalStorage';

const CACHE_VERSION = 1;
const KEY_PREFIX = 'nova:listCache:';
/** Same guard as sessionCache: writes near the origin quota block the main thread. */
const MAX_LIST_CHARS = 1_000_000;

type ListCacheName = 'workspaces' | 'sessions';

interface ListCachePayload<T> {
  version: number;
  items: T[];
}

export function readListCache<T>(name: ListCacheName): T[] | null {
  const raw = safeGetItem(KEY_PREFIX + name);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as ListCachePayload<T>;
    if (payload.version !== CACHE_VERSION || !Array.isArray(payload.items) || payload.items.length === 0) {
      return null;
    }
    return payload.items;
  } catch {
    return null;
  }
}

/** An empty list is removed instead of stored, so a cold start shows the loading state rather than "nothing here". */
export function writeListCache<T>(name: ListCacheName, items: T[]): void {
  if (items.length === 0) {
    safeRemoveItem(KEY_PREFIX + name);
    return;
  }
  const payload: ListCachePayload<T> = { version: CACHE_VERSION, items };
  const raw = JSON.stringify(payload);
  if (raw.length > MAX_LIST_CHARS || !safeSetItem(KEY_PREFIX + name, raw)) {
    // A stale list that can no longer be updated would be worse than none
    safeRemoveItem(KEY_PREFIX + name);
  }
}

export function clearListCaches(): void {
  safeRemoveItem(`${KEY_PREFIX}workspaces`);
  safeRemoveItem(`${KEY_PREFIX}sessions`);
}
