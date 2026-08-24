// node_modules
import { computed, onUnmounted, watch } from 'vue';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';

// utils
import { isSessionUnread } from '@/utils/sessionUnread';
import { countTabStatus, deriveTabStatus, formatTabTitle } from '@/utils/tabStatus';
import { applyTabStatusIcon, resetTabStatusIcon } from '@/lib/tabStatusIcon';

/**
 * Keeps the browser tab reporting whether any chat is working and whether
 * anything finished without being looked at. Both watched values are strings,
 * so streaming chat updates that leave the state unchanged never repaint the
 * favicon — a tab strip that flickers reads as a page stuck reloading.
 */
export function useTabStatus(): void {
  const workspacesStore = useWorkspacesStore();

  const counts = computed(() => countTabStatus(workspacesStore.allSessions, isSessionUnread));
  const status = computed(() => deriveTabStatus(counts.value));
  const title = computed(() => formatTabTitle(counts.value));

  watch(
    status,
    (next) => {
      void applyTabStatusIcon(next);
    },
    { immediate: true }
  );

  watch(
    title,
    (next) => {
      document.title = next;
    },
    { immediate: true }
  );

  onUnmounted(() => {
    resetTabStatusIcon();
  });
}
