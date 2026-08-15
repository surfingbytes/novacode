import { ref } from 'vue';
import { safeGetItem, safeSetItem } from '@/lib/safeLocalStorage';

const STORAGE_KEY = 'novacode:sessionUnread';

const viewingSessionId = ref<string | null>(null);
const unreadIds = ref<Set<string>>(loadUnreadIds());

function loadUnreadIds(): Set<string> {
  try {
    const raw = safeGetItem(STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

function persistUnreadIds(): void {
  try {
    safeSetItem(STORAGE_KEY, JSON.stringify([...unreadIds.value]));
  } catch {
    // quota / private mode
  }
}

export function setViewingSession(sessionId: string | null): void {
  viewingSessionId.value = sessionId;
  if (sessionId) {
    clearSessionUnread(sessionId);
  }
}

export function markSessionFinished(sessionId: string): void {
  if (!sessionId || viewingSessionId.value === sessionId) {
    return;
  }
  if (unreadIds.value.has(sessionId)) {
    return;
  }
  const next = new Set(unreadIds.value);
  next.add(sessionId);
  unreadIds.value = next;
  persistUnreadIds();
}

export function clearSessionUnread(sessionId: string): void {
  if (!unreadIds.value.has(sessionId)) {
    return;
  }
  const next = new Set(unreadIds.value);
  next.delete(sessionId);
  unreadIds.value = next;
  persistUnreadIds();
}

export function isSessionUnread(sessionId: string): boolean {
  return unreadIds.value.has(sessionId);
}

export function resetSessionUnreadState(): void {
  viewingSessionId.value = null;
  unreadIds.value = new Set();
  persistUnreadIds();
}

export { unreadIds };
