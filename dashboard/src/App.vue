<script setup lang="ts">
// node_modules
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';

// components
import ApiOfflineBanner from '@/components/ApiOfflineBanner.vue';
import AppLayout from '@/components/AppLayout.vue';
import AppToasts from '@/components/AppToasts.vue';

// stores
import { useApiHealthStore } from '@/stores/apiHealth';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toasts';
import { useWorkspacesStore } from '@/stores/workspaces';

// classes
import router from '@/classes/router';
import { settingsApi, setUnauthorizedHandler } from '@/classes/api';
import { applyActiveTheme, stopAutoThemeWatcher } from '@/lib/themes';
import { safeSetItem } from '@/lib/safeLocalStorage';
import { isNotificationsEnabled, syncPushSubscription } from '@/lib/notifications';

// -------------------------------------------------- Store --------------------------------------------------
const auth = useAuthStore();
const apiHealth = useApiHealthStore();
const toastStore = useToastStore();
const workspacesStore = useWorkspacesStore();
const route = useRoute();

// -------------------------------------------------- Refs --------------------------------------------------
let healthPollId: ReturnType<typeof setInterval> | null = null;

// -------------------------------------------------- Computed --------------------------------------------------
const bShowNavBar = computed(() => !route.meta.public);

// -------------------------------------------------- Methods --------------------------------------------------
function setupVisibilityCheck(): void {
  if (document.visibilityState === 'visible') {
    navigator.serviceWorker?.getRegistration()?.then((reg) => {
      reg?.update().catch(() => {
        // ignore errors, we'll just retry on next visibility change
      });
    });
  }
}

async function syncSettingsFromDb(): Promise<void> {
  try {
    const { data } = await settingsApi.get();
    if (data.darkTheme) {
      safeSetItem('darkTheme', data.darkTheme);
    }
    if (data.lightTheme) {
      safeSetItem('lightTheme', data.lightTheme);
    }
    // Authenticated settings are the source of truth — always write autoTheme,
    // including false. Skipping false left localStorage null, which the client
    // treats as "follow OS" and forced light mode on most laptops.
    if (typeof data.autoTheme === 'boolean') {
      safeSetItem('autoTheme', String(data.autoTheme));
    }
    if (data.theme) {
      safeSetItem('theme', data.theme);
    }
    applyActiveTheme();
  } catch {
    // not authenticated or server unreachable — keep localStorage values
  }
}

function scheduleHealthPolling(): void {
  if (healthPollId !== null) {
    clearInterval(healthPollId);
  }
  const intervalMs = apiHealth.bApiReachable ? 45000 : 8000;
  healthPollId = window.setInterval(() => {
    void apiHealth.ping();
  }, intervalMs);
}

function onDocumentVisibilityChange(): void {
  setupVisibilityCheck();
  if (document.visibilityState === 'visible') {
    void apiHealth.ping();
    if (auth.bSignedIn) {
      void workspacesStore.reloadIfLoadFailed();
    }
  }
}

function onWindowOnline(): void {
  void apiHealth.ping();
  if (auth.bSignedIn) {
    void workspacesStore.reloadIfLoadFailed();
  }
}

// -------------------------------------------------- Watchers --------------------------------------------------
watch(
  () => apiHealth.bApiReachable,
  (reachable, wasReachable) => {
    scheduleHealthPolling();
    if (reachable && wasReachable === false && auth.bSignedIn) {
      void workspacesStore.reloadAfterReconnect();
    }
  }
);

// -------------------------------------------------- Lifecycle --------------------------------------------------
onMounted(async (): Promise<void> => {
  applyActiveTheme();

  // Mid-session 401 on any API call → log out and send the user back to
  // login, preserving the deep link they were on.
  setUnauthorizedHandler(() => {
    if (!auth.bSignedIn) {
      return;
    }
    auth.logout();
    toastStore.info('Your session has expired — please log in again.');
    const currentPath = router.currentRoute.value.fullPath;
    void router.push({
      name: 'login',
      query: currentPath && currentPath !== '/' ? { redirect: currentPath } : {}
    });
  });

  void apiHealth.ping();
  scheduleHealthPolling();
  document.addEventListener('visibilitychange', onDocumentVisibilityChange);
  window.addEventListener('online', onWindowOnline);
  if (auth.bSignedIn && !auth.bValidated) {
    await auth.validate();
  }
  if (auth.bValidated) {
    await syncSettingsFromDb();
  }
  if (isNotificationsEnabled()) {
    try {
      await syncPushSubscription(true);
    } catch {
      // ignore push registration failures
    }
  }
});

onUnmounted((): void => {
  document.removeEventListener('visibilitychange', onDocumentVisibilityChange);
  window.removeEventListener('online', onWindowOnline);
  if (healthPollId !== null) {
    clearInterval(healthPollId);
    healthPollId = null;
  }
  setUnauthorizedHandler(null);
  stopAutoThemeWatcher();
});
</script>

<template>
  <div class="flex flex-col app-shell">
    <ApiOfflineBanner />
    <AppLayout v-if="bShowNavBar" class="min-h-0 flex-1" />
    <template v-else>
      <RouterView class="flex min-h-0 flex-1 flex-col" />
    </template>
    <AppToasts />
  </div>
</template>
