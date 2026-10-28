<script setup lang="ts">
// node_modules
import { computed } from 'vue';

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  kind: 'done' | 'unread' | 'running';
  /** Overrides the default text for the kind. */
  label?: string;
}>();

// -------------------------------------------------- Computed --------------------------------------------------

const KIND_CLASS = {
  done: 'bg-success/15 text-success',
  unread: 'bg-primary/15 text-primary',
  running: 'bg-warning/15 text-warning'
} as const;

const KIND_LABEL = {
  done: 'Done',
  unread: 'Unread',
  running: 'Running'
} as const;

const text = computed(() => props.label ?? KIND_LABEL[props.kind]);
</script>

<template>
  <span
    class="inline-flex items-center shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none"
    :class="KIND_CLASS[kind]"
  >
    {{ text }}
  </span>
</template>
