/**
 * Mirrors live session-list data (rename, busy background tasks) into an open chat
 * and marks the viewed session as read. Extracted from SessionChat.vue.
 */

// node_modules
import { computed, onUnmounted, watch, type Ref } from 'vue';

// classes
import { setViewingSession } from '@/utils/sessionUnread';

// types
import type { Session } from '@/@types/index';

// -------------------------------------------------- Types --------------------------------------------------

export interface UseStoreSessionSyncOptions {
  sessionId: () => string;
  session: Ref<Session | null>;
  workspacesStore: { allSessions: Session[]; markSessionRead: (sessionId: string) => Promise<void> };
}

export function useStoreSessionSync(options: UseStoreSessionSyncOptions) {
  const { session, workspacesStore } = options;

  // -------------------------------------------------- Computed --------------------------------------------------
  const liveBusySubagents = computed(() => {
    const fromStore = workspacesStore.allSessions.find(
      (storeSession) => storeSession.id === options.sessionId()
    )?.busySubagents;
    if (fromStore && fromStore.total > 0) {
      return fromStore;
    }
    return null;
  });

  // -------------------------------------------------- Watchers --------------------------------------------------
  watch(
    () =>
      workspacesStore.allSessions.find((storeSession) => storeSession.id === options.sessionId())
        ?.name,
    (storeName) => {
      if (!session.value || storeName === undefined) {
        return;
      }
      if (session.value.name === storeName) {
        return;
      }
      session.value = { ...session.value, name: storeName };
    }
  );

  // The open chat is "viewing" its session: unread tracking skips it and it is marked read.
  watch(
    () => options.sessionId(),
    (sessionId) => {
      setViewingSession(sessionId);
      if (sessionId) {
        void workspacesStore.markSessionRead(sessionId);
      }
    },
    { immediate: true }
  );

  // -------------------------------------------------- Lifecycle --------------------------------------------------
  onUnmounted(() => {
    setViewingSession(null);
  });

  return {
    // data
    liveBusySubagents
  };
}

export type UseStoreSessionSync = ReturnType<typeof useStoreSessionSync>;
