<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import {
  applyTheme,
  resolveStoredThemeId,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  stopAutoThemeWatcher
} from '@/lib/themes';

defineProps<{
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  onMenuClick: () => void;
  onSearchClick: () => void;
}>();

defineEmits<{
  (e: 'toggleCollapsed'): void;
}>();

const auth = useAuthStore();

const currentMode = ref<'dark' | 'light'>(
  (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') ?? 'dark'
);

function userInitial(): string {
  const name = auth.username ?? '';
  return name.charAt(0).toUpperCase() || 'U';
}

function toggleTheme(): void {
  const isDark = currentMode.value === 'dark';
  if (isDark) {
    const lightId = resolveStoredThemeId(localStorage.getItem('lightTheme') ?? DEFAULT_LIGHT_THEME_ID);
    applyTheme(lightId);
    localStorage.setItem('theme', lightId);
    localStorage.setItem('autoTheme', 'false');
    stopAutoThemeWatcher();
    currentMode.value = 'light';
  } else {
    const darkId = resolveStoredThemeId(localStorage.getItem('darkTheme') ?? DEFAULT_DARK_THEME_ID);
    applyTheme(darkId);
    localStorage.setItem('theme', darkId);
    localStorage.setItem('autoTheme', 'false');
    stopAutoThemeWatcher();
    currentMode.value = 'dark';
  }
}
</script>

<template>
  <header class="topbar">
    <!-- Sidebar toggle -->
    <button
      type="button"
      class="topbar__toggle"
      :aria-label="sidebarOpen || !sidebarCollapsed ? 'Collapse sidebar' : 'Expand sidebar'"
      @click="$emit('toggleCollapsed')"
    >
      <svg
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
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18" />
      </svg>
    </button>

    <!-- Mobile menu toggle (shows on small screens only, separate from collapse) -->
    <button
      type="button"
      class="topbar__mobile-menu lg:hidden!"
      aria-label="Toggle navigation menu"
      :aria-expanded="sidebarOpen"
      @click="onMenuClick"
    >
      <svg
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
        <path d="M3 6h18 M3 12h18 M3 18h18" />
      </svg>
    </button>

    <!-- Search -->
    <button class="topbar__search" aria-label="Search" @click="onSearchClick">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M16.5 16.5L21 21" />
      </svg>
      <span class="topbar__search-placeholder">Search sessions, files, workspaces…</span>
      <kbd class="topbar__kbd">⌘K</kbd>
    </button>

    <div class="topbar__spacer" aria-hidden="true" />

    <!-- Theme toggle -->
    <button
      type="button"
      class="topbar__theme-toggle"
      :aria-label="currentMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
      :title="currentMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
      @click="toggleTheme"
    >
      <!-- Sun icon (shown in dark mode to switch to light) -->
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
        <path d="M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4 M12 7a5 5 0 100 10 5 5 0 000-10z" />
      </svg>
      <!-- Moon icon (shown in light mode to switch to dark) -->
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

    <div class="topbar__divider" aria-hidden="true" />

    <!-- User -->
    <div class="topbar__user" :title="auth.username ?? ''">
      <div class="topbar__avatar" aria-hidden="true">{{ userInitial() }}</div>
      <span class="topbar__username">{{ auth.username }}</span>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
  gap: 10px;
  flex-shrink: 0;
}

.topbar__toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition:
    background 0.1s,
    color 0.1s;
  flex-shrink: 0;
}
.topbar__toggle:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.topbar__mobile-menu {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition:
    background 0.1s,
    color 0.1s;
  flex-shrink: 0;
}
.topbar__mobile-menu:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.topbar__search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px;
  background: var(--bg-elev);
  border-radius: 6px;
  border: 1px solid transparent;
  color: var(--fg-subtle);
  cursor: text;
  font-size: 13px;
  font-family: inherit;
  flex: 1;
  max-width: 520px;
  transition: border-color 0.12s;
  text-align: left;
}
.topbar__search:hover {
  border-color: var(--line-strong);
}

.topbar__search-placeholder {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.topbar__kbd {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  color: var(--fg-muted);
  background: var(--bg-elev-2);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0 5px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  line-height: 1;
}

.topbar__spacer {
  flex: 1;
}

.topbar__theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
}
.topbar__theme-toggle:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.topbar__divider {
  width: 1px;
  height: 16px;
  background: var(--line);
  flex-shrink: 0;
}

.topbar__user {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 4px;
  flex-shrink: 0;
}

.topbar__avatar {
  width: 24px;
  height: 24px;
  border-radius: 12px;
  background: var(--accent-soft);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11.5px;
  font-weight: 600;
  flex-shrink: 0;
}

.topbar__username {
  font-size: 13px;
  color: var(--fg-muted);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1023px) {
  .topbar__search {
    display: none;
  }
  .topbar__username {
    display: none;
  }
  /* Hide desktop toggle on mobile, show hamburger instead */
  .topbar__toggle {
    display: none;
  }
}
</style>
