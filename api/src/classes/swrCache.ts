// node_modules
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SwrEntry<T> {
  value: T;
  fetchedAt: number;
}

export interface SwrCacheOptions<T> {
  ttlMs: number;
  isValid: (value: T) => boolean;
  loadDisk?: () => SwrEntry<T> | null;
  saveDisk?: (entry: SwrEntry<T>) => void;
}

export function readSwrDiskCache<T>(filePath: string): SwrEntry<T> | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<SwrEntry<T>>;
    if (typeof parsed?.fetchedAt !== 'number' || parsed.value === undefined) return null;
    return { value: parsed.value, fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

export function writeSwrDiskCache<T>(filePath: string, entry: SwrEntry<T>): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(entry), 'utf8');
}

export function createSwrCache<T>(opts: SwrCacheOptions<T>) {
  let memory: SwrEntry<T> | null = null;
  let lastAttemptAt = 0;
  let inFlight: Promise<T> | null = null;
  let diskLoaded = false;

  function hydrateFromDisk(): void {
    if (diskLoaded) return;
    diskLoaded = true;
    const disk = opts.loadDisk?.() ?? null;
    if (disk && opts.isValid(disk.value)) {
      memory = disk;
      lastAttemptAt = disk.fetchedAt;
    }
  }

  function remember(value: T): void {
    if (!opts.isValid(value)) return;
    const entry = { value, fetchedAt: Date.now() };
    memory = entry;
    lastAttemptAt = entry.fetchedAt;
    try {
      opts.saveDisk?.(entry);
    } catch {
      // disk write is best-effort
    }
  }

  function shouldRefresh(now: number): boolean {
    if (inFlight) return false;
    return now - lastAttemptAt >= opts.ttlMs;
  }

  function refresh(fetchFresh: () => Promise<T>): Promise<T> {
    if (!inFlight) {
      lastAttemptAt = Date.now();
      inFlight = fetchFresh()
        .then((value) => {
          remember(value);
          return value;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  }

  async function get(fetchFresh: () => Promise<T>): Promise<{ value: T; fromCache: boolean }> {
    hydrateFromDisk();
    const now = Date.now();
    if (memory && opts.isValid(memory.value)) {
      if (shouldRefresh(now)) {
        void refresh(fetchFresh);
      }
      return { value: memory.value, fromCache: true };
    }
    const value = await refresh(fetchFresh);
    if (memory && opts.isValid(memory.value)) {
      return { value: memory.value, fromCache: false };
    }
    return { value, fromCache: false };
  }

  return {
    get,
    refresh,
    hydrateFromDisk,
    pending: async (): Promise<void> => {
      if (inFlight) await inFlight;
    },
    reset(): void {
      memory = null;
      lastAttemptAt = 0;
      inFlight = null;
      diskLoaded = false;
    },
  };
}
