<script setup lang="ts">
// node_modules
import { computed } from 'vue';

// -------------------------------------------------- Props --------------------------------------------------
const props = defineProps<{
  tabs: Array<{ id: string; label: string; bVisible?: boolean }>;
  modelValue: string;
}>();

// -------------------------------------------------- Emits --------------------------------------------------
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

// -------------------------------------------------- Computed --------------------------------------------------
const visibleTabs = computed(() => props.tabs.filter((tab) => tab.bVisible !== false));

// -------------------------------------------------- Methods --------------------------------------------------
function selectTab(id: string): void {
  emit('update:modelValue', id);
}
</script>

<template>
  <div
    class="flex border-t border-fg/10 shrink-0 md:border-none md:justify-center md:pb-4 md:mb-4"
  >
    <div
      role="tablist"
      class="flex flex-1 max-w-md mx-auto md:flex-none md:inline-flex md:items-center md:gap-1.5 md:px-1.5 md:py-1.5 md:rounded-full md:border md:border-fg/15 md:bg-fg/[0.02] md:shadow-sm"
    >
      <button
        v-for="tab in visibleTabs"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="modelValue === tab.id"
        class="flex-1 md:flex-none px-4 py-3 text-sm md:px-4 md:py-2 md:text-sm font-medium transition-colors border-t-2 md:border-t-0 md:rounded-full"
        :class="
          modelValue === tab.id
            ? 'text-text-primary border-primary md:bg-fg/[0.09]'
            : 'text-text-muted hover:text-text-primary border-transparent'
        "
        @click="selectTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>
  </div>
</template>
