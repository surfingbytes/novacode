<script setup lang="ts">
// -------------------------------------------------- Props --------------------------------------------------
const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    disabled?: boolean;
    ariaLabel?: string;
  }>(),
  {
    disabled: false,
    ariaLabel: undefined
  }
);

// -------------------------------------------------- Emits --------------------------------------------------
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

// -------------------------------------------------- Methods --------------------------------------------------
function onToggle(): void {
  if (props.disabled) {
    return;
  }
  emit('update:modelValue', !props.modelValue);
}
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="ariaLabel"
    :disabled="disabled"
    class="nc-toggle"
    :class="modelValue ? 'on' : ''"
    @click="onToggle"
  ><span class="nc-toggle-knob" /></button>
</template>
