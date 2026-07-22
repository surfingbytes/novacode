<script setup lang="ts">
// node_modules
import { computed } from 'vue';

// -------------------------------------------------- Props --------------------------------------------------
const props = withDefaults(
  defineProps<{
    variant?: 'default' | 'primary' | 'danger' | 'warning' | 'ghost' | 'icon';
    size?: 'md' | 'sm';
    loading?: boolean;
    disabled?: boolean;
    ariaLabel?: string;
  }>(),
  {
    variant: 'default',
    size: 'md',
    loading: false,
    disabled: false,
    ariaLabel: undefined
  }
);

// -------------------------------------------------- Emits --------------------------------------------------
const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void;
}>();

// -------------------------------------------------- Computed --------------------------------------------------
const variantClass = computed<string>(() => {
  switch (props.variant) {
    case 'primary': {
      return 'is-primary';
    }
    case 'danger': {
      return 'is-destructive';
    }
    case 'warning': {
      return 'is-warning';
    }
    case 'ghost': {
      return 'is-transparent';
    }
    case 'icon': {
      return 'is-icon';
    }
    default: {
      return '';
    }
  }
});

const sizeClass = computed<string>(() =>
  props.size === 'sm' ? 'h-[26px]! px-2! text-xs!' : ''
);

// -------------------------------------------------- Methods --------------------------------------------------
function onClick(event: MouseEvent): void {
  if (props.disabled || props.loading) {
    return;
  }
  emit('click', event);
}
</script>

<template>
  <button
    type="button"
    class="button"
    :class="[variantClass, sizeClass]"
    :disabled="disabled || loading"
    :aria-label="ariaLabel"
    @click="onClick"
  >
    <span
      v-if="loading"
      class="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0"
      aria-hidden="true"
    ></span>
    <slot />
  </button>
</template>
