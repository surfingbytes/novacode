<script setup lang="ts">
// -------------------------------------------------- Props --------------------------------------------------

withDefaults(
  defineProps<{
    /** Width: CSS value e.g. '100%', '60%', '8rem'. */
    width?: string;
    /** Height: CSS value e.g. '1rem', '0.75rem'. */
    height?: string;
    /** Optional extra class for the bar. */
    extraClass?: string;
  }>(),
  { width: '100%', height: '0.75rem', extraClass: '' }
);
</script>

<template>
  <div
    class="rounded bg-fg/10 animate-pulse"
    :class="extraClass"
    :style="{ width, height }"
  />
</template>
