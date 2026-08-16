// node_modules
import { computed, onMounted, onUnmounted, ref } from 'vue';

// constants
import { PANE_LAYOUT_MIN_WIDTH } from '@/constants/layout';
import { safeSessionGetItem, safeSessionSetItem } from '@/lib/safeLocalStorage';

/** List column: always when nothing is selected so the pane is never an empty content stub. */
export function paneListVisible(
  bWide: boolean,
  bSidePanelOpen: boolean,
  hasSelection: boolean
): boolean {
  if (!hasSelection) return true;
  if (bWide) return bSidePanelOpen;
  return false;
}

/** Detail column: always on wide; on narrow only when something is selected. */
export function paneDetailVisible(bWide: boolean, hasSelection: boolean): boolean {
  if (bWide) return true;
  return hasSelection;
}

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
    if (!storageKey) return null;
    const stored = safeSessionGetItem(storageKey);
    if (stored === '0') return false;
    if (stored === '1') return true;
    return null;
  }

  function setSidePanelOpen(open: boolean): void {
    bSidePanelOpen.value = open;
    if (!storageKey) return;
    safeSessionSetItem(storageKey, open ? '1' : '0');
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

  /** List column: always when nothing is selected; otherwise wide+open, or narrow hidden. */
  function listVisible(hasSelection: boolean): boolean {
    return paneListVisible(bWidePane.value, bSidePanelOpen.value, hasSelection);
  }

  /** Detail column: always on wide; on narrow only when something is selected. */
  function detailVisible(hasSelection: boolean): boolean {
    return paneDetailVisible(bWidePane.value, hasSelection);
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
