/**
 * Session snapshot cache — debounced persist of the session + chat history to localStorage.
 * Extracted from SessionChat.vue.
 */

// node_modules
import { watch, type Ref } from 'vue';

// classes
import { writeSessionCache } from '@/lib/sessionCache';

// types
import type { ChatMessage, Session } from '@/@types/index';

// -------------------------------------------------- Types --------------------------------------------------

export interface UseSessionSnapshotCacheOptions {
  workspaceId: () => string;
  sessionId: () => string;
  session: Ref<Session | null>;
  messages: Ref<ChatMessage[]>;
  bHasMore: Ref<boolean>;
}

export function useSessionSnapshotCache(options: UseSessionSnapshotCacheOptions) {
  let persistCacheTimer: ReturnType<typeof setTimeout> | null = null;
  let persistCacheAllowEmpty = false;

  // -------------------------------------------------- Methods --------------------------------------------------
  function persistSessionCache(allowEmptyMessages = false): void {
    writeSessionCache(
      options.workspaceId(),
      options.sessionId(),
      {
        session: options.session.value,
        messages: options.messages.value,
        bHasMore: options.bHasMore.value
      },
      { allowEmptyMessages }
    );
  }

  function scheduleSessionCachePersist(allowEmptyMessages = false): void {
    persistCacheAllowEmpty = persistCacheAllowEmpty || allowEmptyMessages;
    if (persistCacheTimer !== null) {
      clearTimeout(persistCacheTimer);
    }
    persistCacheTimer = setTimeout(() => {
      persistCacheTimer = null;
      const allow = persistCacheAllowEmpty;
      persistCacheAllowEmpty = false;
      persistSessionCache(allow);
    }, 400);
  }

  /** Drops a pending persist (the chat switched sessions before it fired). */
  function cancelSessionCachePersist(): void {
    if (persistCacheTimer !== null) {
      clearTimeout(persistCacheTimer);
      persistCacheTimer = null;
    }
  }

  /** Writes the snapshot now, replacing any pending persist (on unmount). */
  function flushSessionCache(): void {
    cancelSessionCachePersist();
    persistSessionCache(persistCacheAllowEmpty);
    persistCacheAllowEmpty = false;
  }

  // -------------------------------------------------- Watchers --------------------------------------------------
  watch(options.session, () => {
    scheduleSessionCachePersist();
  });

  return {
    // methods
    persistSessionCache,
    scheduleSessionCachePersist,
    cancelSessionCachePersist,
    flushSessionCache
  };
}

export type UseSessionSnapshotCache = ReturnType<typeof useSessionSnapshotCache>;
