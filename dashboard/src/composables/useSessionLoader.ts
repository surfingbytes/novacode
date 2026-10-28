/**
 * Session loader — fetches session metadata and retries after outages or when the tab returns.
 * Extracted from SessionChat.vue.
 */

// node_modules
import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue';

// classes
import { sessionsApi } from '@/classes/api';

// types
import type { Session } from '@/@types/index';

// -------------------------------------------------- Types --------------------------------------------------

export interface UseSessionLoaderOptions {
  workspaceId: () => string;
  sessionId: () => string;
  session: Ref<Session | null>;
  /** True when nothing (not even a cached snapshot) is on screen yet. */
  bInitiallyLoading: boolean;
  bApiReachable: Ref<boolean>;
  healthyPingCount: Ref<number>;
  /** Called with each fresh session the fetch returns for the current session. */
  onSessionFetched: (session: Session) => void;
  /** Called on a retry trigger when the session itself is loaded (e.g. retry the agent catalog). */
  onRetryLoaded: () => void;
}

export function useSessionLoader(options: UseSessionLoaderOptions) {
  const { session } = options;

  // -------------------------------------------------- Refs --------------------------------------------------
  const bLoading = ref(options.bInitiallyLoading);
  const error = ref<string | null>(null);
  let fetchSessionSeq = 0;
  /** Last fetch failed — set even when a cached snapshot hides the error banner. */
  let bSessionFetchFailed = false;

  // -------------------------------------------------- Methods --------------------------------------------------
  async function fetchSession(): Promise<boolean> {
    const seq = ++fetchSessionSeq;
    const workspaceId = options.workspaceId();
    const sessionId = options.sessionId();
    const bCurrent = () =>
      seq === fetchSessionSeq &&
      workspaceId === options.workspaceId() &&
      sessionId === options.sessionId();
    try {
      // Keep any cached snapshot on screen while revalidating — the skeleton is
      // only for when there is genuinely nothing to show.
      if (!session.value) {
        bLoading.value = true;
      }
      error.value = null;
      const response = await sessionsApi.get(workspaceId, sessionId);
      if (!bCurrent()) {
        return false;
      }
      session.value = response.data;
      bSessionFetchFailed = false;
      options.onSessionFetched(response.data);
      return true;
    } catch (e) {
      if (!bCurrent()) {
        return false;
      }
      bSessionFetchFailed = true;
      if (!session.value) {
        error.value = 'Failed to load session';
      }
      console.error('Failed to fetch session:', e);
      return false;
    } finally {
      if (bCurrent()) {
        bLoading.value = false;
      }
    }
  }

  function retrySessionIfFailed(): void {
    if (bSessionFetchFailed || error.value) {
      void fetchSession();
      return;
    }
    // The session itself loaded but the agent catalog did not (flaky link).
    options.onRetryLoaded();
  }

  function onDocumentVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      retrySessionIfFailed();
    }
  }

  // -------------------------------------------------- Watchers --------------------------------------------------
  // Retry session metadata when the API comes back after a transient outage. A
  // healthy ping counts too: a failed fetch does not always flip the banner.
  watch([options.bApiReachable, options.healthyPingCount], ([reachable]) => {
    if (reachable) {
      retrySessionIfFailed();
    }
  });

  // -------------------------------------------------- Lifecycle --------------------------------------------------
  onMounted(() => {
    document.addEventListener('visibilitychange', onDocumentVisibilityChange);
  });

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onDocumentVisibilityChange);
  });

  return {
    // data
    bLoading,
    error,
    // methods
    fetchSession,
    retrySessionIfFailed
  };
}

export type UseSessionLoader = ReturnType<typeof useSessionLoader>;
