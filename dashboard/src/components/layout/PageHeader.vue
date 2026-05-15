<script setup lang="ts">
defineProps<{
  icon?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
}>();
</script>

<template>
  <header class="page-header">
    <div>
      <div v-if="eyebrow" class="nc-eyebrow page-header__eyebrow">{{ eyebrow }}</div>
      <h1 class="page-header__title">
        <slot name="title">{{ title }}</slot>
      </h1>
      <p v-if="subtitle" class="page-header__subtitle">{{ subtitle }}</p>
    </div>
    <div class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 4px;
}

@media (min-width: 640px) {
  .page-header {
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
  }
}

.page-header__eyebrow {
  margin-bottom: 10px;
}

.page-header__title {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--fg);
  margin: 0;
}

.page-header__subtitle {
  font-size: 14px;
  color: var(--fg-muted);
  margin: 6px 0 0;
}

.page-header__actions {
  flex-shrink: 0;
}
</style>
