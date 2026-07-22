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
    claudeAvailable.value = false;
    cursorAvailable.value = false;
    mistralVibeAvailable.value = false;
    openCodeAvailable.value = false;
    codexAvailable.value = false;
  }
};

/** Fetch capabilities once (no-op while a load is in flight or already succeeded). */
const ensureLoaded = (): void => {
  if (bLoaded || bLoading) {
    return;
  }
  bLoading = true;
  void loadAgentCapabilities().finally(() => {
    bLoading = false;
  });
};

// -------------------------------------------------- Composable --------------------------------------------------

export function useAgentCapabilities() {
  return {
    claudeAvailable,
    cursorAvailable,
    mistralVibeAvailable,
    openCodeAvailable,
    codexAvailable,
    ensureLoaded
  };
}

export type UseAgentCapabilities = ReturnType<typeof useAgentCapabilities>;
