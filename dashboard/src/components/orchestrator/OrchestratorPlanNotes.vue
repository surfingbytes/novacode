<script setup lang="ts">
/** Plan notes (shared context) given to every step. Extracted from OrchestratorPanel.vue. */

// -------------------------------------------------- Props --------------------------------------------------

defineProps<{
  sharedContext: string;
}>();
</script>

<template>
  <div
    v-if="sharedContext"
    class="rounded-xl border border-primary/25 bg-primary/5 overflow-hidden"
  >
    <div class="px-3 py-2 border-b border-fg/10">
      <span class="text-sm font-medium text-text-primary">Plan notes</span>
      <p class="text-xs text-text-muted mt-0.5">
        Given to every step together with the planning chat's spec (read live when the step starts).
      </p>
    </div>
    <div
      class="px-3 py-2 text-sm text-text-muted max-h-40 overflow-y-auto whitespace-pre-wrap break-words"
    >
      {{ sharedContext }}
    </div>
  </div>
</template>
