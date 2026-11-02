/**
 * Prompts sent while the chat socket was down, kept per session until the
 * connection is back. Persisted (localStorage) so a killed PWA does not lose
 * them; all storage failures are swallowed.
 */

// lib
import { safeGetItem, safeLocalStorageKeys, safeRemoveItem, safeSetItem } from '@/lib/safeLocalStorage';

const KEY_PREFIX = 'nova:offlinePrompts:';

export interface OfflinePrompt {
  id: string;
  text: string;
  model: string;
  mode: string;
  imagePaths: string[];
}

export function readOfflinePrompts(sessionId: string): OfflinePrompt[] {
  const raw = safeGetItem(KEY_PREFIX + sessionId);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as OfflinePrompt[]) : [];
  } catch {
    return [];
  }
}

export function writeOfflinePrompts(sessionId: string, prompts: OfflinePrompt[]): void {
  if (prompts.length === 0) {
    safeRemoveItem(KEY_PREFIX + sessionId);
    return;
  }
  safeSetItem(KEY_PREFIX + sessionId, JSON.stringify(prompts));
}

export function removeOfflinePromptsForId(sessionId: string): void {
  safeRemoveItem(KEY_PREFIX + sessionId);
}

export function clearAllOfflinePrompts(): void {
  for (const key of safeLocalStorageKeys()) {
    if (key.startsWith(KEY_PREFIX)) {
      safeRemoveItem(key);
    }
  }
}
