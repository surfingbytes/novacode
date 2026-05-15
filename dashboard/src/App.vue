<script setup lang="ts">
// node_modules
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';

// components
import ApiOfflineBanner from '@/components/ApiOfflineBanner.vue';
import AppLayout from '@/components/AppLayout.vue';

// stores
import { useApiHealthStore } from '@/stores/apiHealth';
import { useAuthStore } from '@/stores/auth';

// classes
import { settingsApi } from '@/classes/api';
import {
  applyTheme,
  DEFAULT_THEME_ID,
  migrateLegacyThemeLocalStorage,
  resolveAutoTheme,
  startAutoThemeWatcher,
  stopAutoThemeWatcher
} from '@/lib/themes';
import { isNotificationsEnabled, syncPushSubscription } from '@/lib/notifications';

// -------------------------------------------------- Store --------------------------------------------------
const auth = useAuthStore();
const apiHealth = useApiHealthStore();
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
      localStorage.setItem('darkTheme', data.darkTheme);
    }
    if (data.lightTheme) {
      localStorage.setItem('lightTheme', data.lightTheme);
    }
    if (typeof data.autoTheme === 'boolean') {
      // If the user never touched auto-theme, default to following OS/browser.
      // Respect an explicit localStorage choice when it already exists.
      const existingAutoTheme = localStorage.getItem('autoTheme');
      if (existingAutoTheme !== null) {
        localStorage.setItem('autoTheme', String(data.autoTheme));
      } else if (data.autoTheme === true) {
        localStorage.setItem('autoTheme', 'true');
      }
    }
    if (data.theme) {
      localStorage.setItem('theme', data.theme);
    }
    applyActiveTheme();
  } catch {
    // not authenticated or server unreachable — keep localStorage values
  }
}

function applyActiveTheme(): void {
  migrateLegacyThemeLocalStorage();
  const autoThemeSetting = localStorage.getItem('autoTheme');
  const autoTheme = autoThemeSetting === null ? true : autoThemeSetting === 'true';
  if (autoTheme) {
    applyTheme(resolveAutoTheme());
    startAutoThemeWatcher();
  } else {
    stopAutoThemeWatcher();
    applyTheme(localStorage.getItem('theme') ?? DEFAULT_THEME_ID);
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
  }
}

// -------------------------------------------------- Watchers --------------------------------------------------
watch(
  () => apiHealth.bApiReachable,
  () => {
    scheduleHealthPolling();
  }
);

// -------------------------------------------------- Lifecycle --------------------------------------------------
onMounted(async (): Promise<void> => {
  applyActiveTheme();

  void apiHealth.ping();
  scheduleHealthPolling();
  document.addEventListener('visibilitychange', onDocumentVisibilityChange);
  if (auth.token && !auth.bValidated) {
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
  if (healthPollId !== null) {
    clearInterval(healthPollId);
    healthPollId = null;
  }
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
  </div>
</template>
