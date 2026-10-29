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
/** True once any fetch succeeded; the flags above are meaningless before that. */
const bCapabilitiesLoaded = ref<boolean>(false);

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
    bCapabilitiesLoaded.value = true;
  } catch {
    // Keep whatever we had — a transient outage (including a failed reconnect
    // refresh) must not wipe the agent picker empty.
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
  if (bCapabilitiesLoaded.value || bLoading) {
    return;
  }
  void startLoad();
};

/**
 * Refresh in the background (e.g. after API reconnect). Previously loaded
 * values stay in place until the new response lands — or stay if it fails.
 */
const reload = (): Promise<void> => startLoad();

// -------------------------------------------------- Composable --------------------------------------------------

export function useAgentCapabilities() {
  return {
    claudeAvailable,
    cursorAvailable,
    mistralVibeAvailable,
    openCodeAvailable,
    codexAvailable,
    bCapabilitiesLoaded,
    ensureLoaded,
    reload
  };
}
