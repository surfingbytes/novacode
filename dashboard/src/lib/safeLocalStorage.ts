/**
 * localStorage / sessionStorage wrappers that never throw.
 * Quota, private mode, and disabled storage must not break UI flows.
 */

function storageGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(storage: Storage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function storageRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // ignore quota / private mode
  }
}

function storageKeys(storage: Storage): string[] {
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

export function safeGetItem(key: string): string | null {
  return storageGet(localStorage, key);
}

export function safeSetItem(key: string, value: string): boolean {
  return storageSet(localStorage, key, value);
}

export function safeRemoveItem(key: string): void {
  storageRemove(localStorage, key);
}

export function safeLocalStorageKeys(): string[] {
  return storageKeys(localStorage);
}

export function safeSessionGetItem(key: string): string | null {
  return storageGet(sessionStorage, key);
}

export function safeSessionSetItem(key: string, value: string): boolean {
  return storageSet(sessionStorage, key, value);
}
