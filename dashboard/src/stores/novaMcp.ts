// node_modules
import { defineStore } from 'pinia';
import { ref } from 'vue';

// classes
import { settingsApi } from '@/classes/api';

/**
 * Whether Nova's own MCP server (spec + orchestrator tools) is enabled.
 * Fetched once on demand; the Settings → MCP toggle updates it after saving.
 * `null` until known (or when the fetch failed).
 */
export const useNovaMcpStore = defineStore('novaMcp', () => {
  // -------------------------------------------------- Refs --------------------------------------------------
  const bEnabled = ref<boolean | null>(null);
  let fetchPromise: Promise<void> | null = null;

  // -------------------------------------------------- Methods --------------------------------------------------
  async function ensureFetched(): Promise<void> {
    if (!fetchPromise) {
      fetchPromise = settingsApi
        .getMcpClients()
        .then(({ data }) => {
          bEnabled.value = data.builtin?.nova.enabled ?? null;
        })
        .catch(() => {
          // header controls work without it; a retry happens on the next call
          fetchPromise = null;
        });
    }
    await fetchPromise;
  }

  function setEnabled(bNext: boolean): void {
    bEnabled.value = bNext;
  }

  return {
    bEnabled,
    ensureFetched,
    setEnabled
  };
});
