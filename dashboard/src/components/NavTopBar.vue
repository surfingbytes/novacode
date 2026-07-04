<script setup lang="ts">
defineProps<{
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  onMenuClick: () => void;
  onSearchClick: () => void;
}>();

defineEmits<{
  (e: 'toggleCollapsed'): void;
}>();
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

@media (max-width: 1023px) {
  .topbar__search {
    display: none;
  }
  /* Hide desktop toggle on mobile, show hamburger instead */
  .topbar__toggle {
    display: none;
  }
}
</style>
