<script setup lang="ts">
/**
 * Shared status icon for todo items, plan points and tool-call cards.
 * Accepts TODO_STATUS_* values, plan statuses (completed / in_progress /
 * pending / cancelled) and tool-call statuses (running / success /
 * rejected / failed). Unknown statuses render the empty "pending" circle.
 */

// node_modules
import { computed } from 'vue';

// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(defineProps<{ status: string; size?: number }>(), { size: 13 });

// -------------------------------------------------- Computed --------------------------------------------------

type Variant = 'spinner' | 'check' | 'clock' | 'cancelled' | 'rejected' | 'pending';

const VARIANTS: Record<string, Variant> = {
  running: 'spinner',
  success: 'check',
  completed: 'check',
  TODO_STATUS_COMPLETED: 'check',
  in_progress: 'clock',
  TODO_STATUS_IN_PROGRESS: 'clock',
  cancelled: 'cancelled',
  TODO_STATUS_CANCELLED: 'cancelled',
  rejected: 'rejected',
  failed: 'rejected'
};

/** Tool-call statuses sit inline in a card row; list statuses align with the first text line. */
const TOOL_STATUSES = new Set(['running', 'success', 'rejected', 'failed']);

const variant = computed<Variant>(() => VARIANTS[props.status] ?? 'pending');

const colorClass = computed(() => {
  switch (variant.value) {
    case 'spinner':
    case 'clock':
      return 'text-primary';
    case 'check':
      return 'text-success';
    default:
      return 'text-text-muted';
  }
});

const layoutClass = computed(() => (TOOL_STATUSES.has(props.status) ? '' : 'shrink-0 mt-px'));
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="select-none"
    :class="[colorClass, layoutClass, { 'animate-spin': variant === 'spinner' }]"
    aria-hidden="true"
  >
    <template v-if="variant === 'spinner'">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </template>
    <template v-else-if="variant === 'check'">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </template>
    <template v-else-if="variant === 'clock'">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </template>
    <template v-else-if="variant === 'cancelled'">
      <circle cx="12" cy="12" r="10" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </template>
    <template v-else-if="variant === 'rejected'">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </template>
    <circle v-else cx="12" cy="12" r="10" />
  </svg>
</template>
