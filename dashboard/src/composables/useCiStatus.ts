// node_modules
import { onUnmounted, ref, watch, type Ref } from 'vue';

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
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  const clearTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const schedule = (): void => {
    clearTimer();
    if (!opts.active.value || document.visibilityState !== 'visible') return;
    // Not configured: check again rarely in case a forge gets set up in another tab.
    const delay = status.value && !status.value.configured ? 120_000 : ciPollIntervalMs(status.value);
    timer = setTimeout(() => void refresh(), delay);
  };

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
      if (gen === generation) {
        bLoading.value = false;
        schedule();
      }
    }
  };

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible' && opts.active.value) void refresh();
    else clearTimer();
  };

  const trigger = opts.trigger ?? ref(null);
  watch(
    [opts.workspaceId, opts.repo, opts.active, trigger],
    ([, , active], previous) => {
      const [prevWorkspace, prevRepo] = previous ?? [];
      if (prevWorkspace !== opts.workspaceId.value || prevRepo !== opts.repo.value) status.value = null;
      if (active) void refresh();
      else clearTimer();
    },
    { immediate: true }
  );

  document.addEventListener('visibilitychange', onVisibility);
  onUnmounted(() => {
    generation++;
    clearTimer();
    document.removeEventListener('visibilitychange', onVisibility);
  });

  return { status, bLoading, refresh };
}
