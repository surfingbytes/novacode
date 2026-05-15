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
  min-height: calc(100dvh - 52px);
  display: flex;
  flex-direction: column;
  flex: 1;
  background: var(--bg);
  width: 100%;
}

.page-shell__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 1040px;
  margin: 0 auto;
  padding: 32px 40px 40px;
}

@media (max-width: 767px) {
  .page-shell__main {
    padding: 20px 16px 32px;
  }
}
</style>
