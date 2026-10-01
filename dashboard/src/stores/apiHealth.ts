// node_modules
import { defineStore } from 'pinia';
import { ref } from 'vue';

function healthUrl(): string {
  const base = (import.meta.env.VITE_API_URL || `${location.origin}/api`).replace(/\/$/, '');
  return `${base}/health`;
}

export const useApiHealthStore = defineStore('apiHealth', () => {
  const bApiReachable = ref(true);
  /** Bumped on every successful /health ping, even when the banner never flipped. */
  const healthyPingCount = ref(0);

  function markUnreachable(): void {
    bApiReachable.value = false;
  }

  function markReachable(): void {
    bApiReachable.value = true;
  }

  async function ping(): Promise<void> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(healthUrl(), {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });
      if (response.ok) {
        markReachable();
        healthyPingCount.value++;
      } else {
        markUnreachable();
      }
    } catch {
      markUnreachable();
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  return {
    bApiReachable,
    healthyPingCount,
    markUnreachable,
    markReachable,
    ping
  };
});
