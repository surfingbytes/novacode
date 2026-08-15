<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { settingsApi } from '@/classes/api';
import {
  applyTheme,
  resolveStoredThemeId,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  stopAutoThemeWatcher
} from '@/lib/themes';
import { safeGetItem, safeSetItem } from '@/lib/safeLocalStorage';

withDefaults(
  defineProps<{
    /** Compact icon-only style for sidebar footer */
    compact?: boolean;
  }>(),
  { compact: false }
);

function readMode(): 'dark' | 'light' {
  return (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') ?? 'dark';
}

const currentMode = ref<'dark' | 'light'>(readMode());

function syncModeFromDom(): void {
  currentMode.value = readMode();
}

async function toggleTheme(): Promise<void> {
  const isDark = currentMode.value === 'dark';
  const nextThemeId = isDark
    ? resolveStoredThemeId(safeGetItem('lightTheme') ?? DEFAULT_LIGHT_THEME_ID)
    : resolveStoredThemeId(safeGetItem('darkTheme') ?? DEFAULT_DARK_THEME_ID);
  const nextMode = isDark ? 'light' : 'dark';

  applyTheme(nextThemeId);
  safeSetItem('theme', nextThemeId);
  safeSetItem('autoTheme', 'false');
  stopAutoThemeWatcher();
  currentMode.value = nextMode;

  // Persist so a cold start / new device syncs the chosen light/dark mode
  try {
    await settingsApi.update({ theme: nextThemeId, autoTheme: false });
  } catch {
    // offline / unauthenticated — localStorage still applies for this device
  }
}

onMounted(() => {
  syncModeFromDom();
  window.addEventListener('nc-theme-changed', syncModeFromDom);
});

onUnmounted(() => {
  window.removeEventListener('nc-theme-changed', syncModeFromDom);
});
</script>

<template>
  <button
    type="button"
    :class="compact ? 'theme-toggle--compact' : 'theme-toggle'"
    :aria-label="currentMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
    :title="currentMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
    @click="toggleTheme"
  >
    <svg
      v-if="currentMode === 'dark'"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path
        d="M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4 M12 7a5 5 0 100 10 5 5 0 000-10z"
      />
    </svg>
    <svg
      v-else
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
    </svg>
  </button>
</template>

<style scoped>
.theme-toggle,
.theme-toggle--compact {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
}

.theme-toggle {
  width: 26px;
  height: 26px;
  border-radius: 6px;
}

.theme-toggle--compact {
  width: 32px;
  height: 32px;
  border-radius: 6px;
}

.theme-toggle:hover,
.theme-toggle--compact:hover {
  background: var(--bg-hover);
  color: var(--fg);
}
</style>
