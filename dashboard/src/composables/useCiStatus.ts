// node_modules
import { getCurrentScope, onScopeDispose, ref, watch, type Ref } from 'vue';

// composables
import { usePolling } from '@/composables/usePolling';

// classes
import { forgeApi } from '@/classes/api';

// utils
import { ciPollIntervalMs } from '@/utils/ciStatusDisplay';

// types
import type { CiStatusResponse } from '@/@types/index';

/**
 * Polls Gitea/Forgejo CI status for a workspace repo while `active` and the page is
 * visible. The API caches upstream calls, so several consumers (Git tab, header badge)
 * stay cheap.
 */
export function useCiStatus(opts: {
  workspaceId: Ref<string>;
  repo: Ref<string>;
  sessionId?: Ref<string | null | undefined>;
  active: Ref<boolean>;
  /** Re-fetch when this changes (e.g. the checked-out branch). */
  trigger?: Ref<unknown>;
}): {
  status: Ref<CiStatusResponse | null>;
  bLoading: Ref<boolean>;
  refresh: () => Promise<void>;
} {
  const status = ref<CiStatusResponse | null>(null);
  const bLoading = ref<boolean>(false);
  let generation = 0;

  const refresh = async (): Promise<void> => {
    const gen = ++generation;
    bLoading.value = true;
    try {
      const { data } = await forgeApi.ciStatus(opts.workspaceId.value, {
        repo: opts.repo.value,
        sessionId: opts.sessionId?.value ?? null
      });
      if (gen === generation) status.value = data;
    } catch {
      // keep the last known status; transient API errors should not blank the badge
    } finally {
      if (gen === generation) bLoading.value = false;
    }
  };

  // Not configured: check again rarely in case a forge gets set up in another tab.
  const poll = usePolling(refresh, () =>
    status.value && !status.value.configured ? 120_000 : ciPollIntervalMs(status.value)
  );

  const trigger = opts.trigger ?? ref(null);
  watch(
    [opts.workspaceId, opts.repo, opts.active, trigger],
    ([, , active], previous) => {
      const [prevWorkspace, prevRepo] = previous ?? [];
      if (prevWorkspace !== opts.workspaceId.value || prevRepo !== opts.repo.value) status.value = null;
      poll.stop();
      if (!active) return;
      // Direct refresh (not poll.trigger) so a new repo is fetched even while an older request is in flight.
      if (document.visibilityState !== 'hidden') void refresh();
      poll.start();
    },
    { immediate: true }
  );

  if (getCurrentScope()) {
    onScopeDispose(() => {
      generation++;
      poll.stop();
    });
  }

  return { status, bLoading, refresh };
}
