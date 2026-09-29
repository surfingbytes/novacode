/**
 * Agent capability flags (which agent CLIs are available server-side).
 * Shared module-level state: fetched once and reused by every view.
 */

// node_modules
import { ref } from 'vue';

// classes
import { settingsApi } from '@/classes/api';

// -------------------------------------------------- Shared state --------------------------------------------------

const claudeAvailable = ref<boolean>(false);
const cursorAvailable = ref<boolean>(false);
const mistralVibeAvailable = ref<boolean>(false);
const openCodeAvailable = ref<boolean>(false);
const codexAvailable = ref<boolean>(false);

let bLoaded = false;
let bLoading = false;
let loadPromise: Promise<void> | null = null;

// -------------------------------------------------- Methods --------------------------------------------------

const loadAgentCapabilities = async (): Promise<void> => {
  try {
    const { data } = await settingsApi.getAgentCapabilities();
    claudeAvailable.value = data.claudeAvailable;
    cursorAvailable.value = data.cursorAvailable;
    mistralVibeAvailable.value = data.mistralVibeAvailable;
    openCodeAvailable.value = data.openCodeAvailable;
    codexAvailable.value = data.codexAvailable;
    bLoaded = true;
  } catch {
    // Keep any previously successful values — a transient outage should not
    // wipe the agent picker empty until the next successful fetch.
    if (!bLoaded) {
      claudeAvailable.value = false;
      cursorAvailable.value = false;
      mistralVibeAvailable.value = false;
      openCodeAvailable.value = false;
      codexAvailable.value = false;
    }
  }
};

function startLoad(): Promise<void> {
  if (loadPromise) {
    return loadPromise;
  }
  bLoading = true;
  loadPromise = loadAgentCapabilities().finally(() => {
    bLoading = false;
    loadPromise = null;
  });
  return loadPromise;
}

/** Fetch capabilities once (no-op while a load is in flight or already succeeded). */
const ensureLoaded = (): void => {
  if (bLoaded || bLoading) {
    return;
  }
  void startLoad();
};

/** Force a refresh (e.g. after API reconnect or when opening the new-session modal). */
const reload = (): Promise<void> => {
  bLoaded = false;
  return startLoad();
};

// -------------------------------------------------- Composable --------------------------------------------------

export function useAgentCapabilities() {
  return {
    claudeAvailable,
    cursorAvailable,
    mistralVibeAvailable,
    openCodeAvailable,
    codexAvailable,
    ensureLoaded,
    reload
  };
}

export type UseAgentCapabilities = ReturnType<typeof useAgentCapabilities>;
