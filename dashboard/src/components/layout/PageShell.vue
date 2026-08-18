<script setup lang="ts">
// Intentionally no props: enforce a single layout style app-wide.
</script>

<template>
  <div class="page-shell">
    <main class="page-shell__main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.page-shell {
  /* Fill the AppLayout main pane. min-height: 0 lets this flex item shrink so
     page-shell__main gets a bounded height and can scroll. */
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  background: var(--bg);
  width: 100%;
}

.page-shell__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  width: 100%;
  max-width: 1040px;
  margin: 0 auto;
  padding: 32px 40px 40px;
}

/* Slot content is from parent views, so :deep is required.
   Flex items with overflow:hidden (e.g. .list-view) have min-height:auto = 0
   and would shrink-to-fit this column instead of overflowing it — the page
   then cannot scroll. Keep document children at content height.
   Pane routes opt out with .flex-1 (Files, Git). */
.page-shell__main > :deep(*:not(.flex-1)) {
  flex-shrink: 0;
}

@media (max-width: 767px) {
  .page-shell__main {
    padding: 20px 16px 32px;
  }
}
</style>
