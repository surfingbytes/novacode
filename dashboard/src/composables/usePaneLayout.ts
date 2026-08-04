// node_modules
import { computed, onMounted, onUnmounted, ref } from 'vue';

// constants
import { PANE_LAYOUT_MIN_WIDTH } from '@/constants/layout';

/**
 * Wide-viewport master-detail layout helper for foldables / tablets.
 * Side panel can be fully hidden (toolbar toggle) to maximize content space.
 */
export function usePaneLayout(storageKey?: string) {
  const query = `(min-width: ${PANE_LAYOUT_MIN_WIDTH}px)`;
  const bWidePane = ref(
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );
  const bSidePanelOpen = ref(true);
  let mediaQuery: MediaQueryList | null = null;

  function readStoredOpen(): boolean | null {
    if (!storageKey || typeof sessionStorage === 'undefined') return null;
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored === '0') return false;
      if (stored === '1') return true;
    } catch {
      /* ignore quota / private mode */
    }
    return null;
  }

  function setSidePanelOpen(open: boolean): void {
    bSidePanelOpen.value = open;
    if (!storageKey || typeof sessionStorage === 'undefined') return;
    try {
      sessionStorage.setItem(storageKey, open ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  function toggleSidePanel(): void {
    setSidePanelOpen(!bSidePanelOpen.value);
  }

  function onMediaChange(event: MediaQueryListEvent): void {
    bWidePane.value = event.matches;
  }

  onMounted(() => {
    const stored = readStoredOpen();
    if (stored !== null) bSidePanelOpen.value = stored;
    mediaQuery = window.matchMedia(query);
    bWidePane.value = mediaQuery.matches;
    mediaQuery.addEventListener('change', onMediaChange);
  });

  onUnmounted(() => {
    mediaQuery?.removeEventListener('change', onMediaChange);
    mediaQuery = null;
  });

  /** List column: always on narrow when nothing selected; on wide only when open. */
  function listVisible(hasSelection: boolean): boolean {
    if (bWidePane.value) return bSidePanelOpen.value;
    return !hasSelection;
  }

  /** Detail column: always on wide; on narrow only when something is selected. */
  function detailVisible(hasSelection: boolean): boolean {
    if (bWidePane.value) return true;
    return hasSelection;
  }

  const bSidePanelToggleVisible = computed(() => bWidePane.value);

  return {
    bWidePane,
    bSidePanelOpen,
    bSidePanelToggleVisible,
    setSidePanelOpen,
    toggleSidePanel,
    listVisible,
    detailVisible
  };
}
