<script setup lang="ts" generic="T">
// node_modules
import { computed, ref } from 'vue';

// composables
import { useVirtualList } from '@/composables/useVirtualList';

// utils
import { VIRTUAL_LIST_THRESHOLD } from '@/utils/virtualWindow';

// -------------------------------------------------- Props --------------------------------------------------
const props = withDefaults(
  defineProps<{
    items: readonly T[];
    itemKey: (item: T) => string;
    /** Height (px) assumed for items that were not rendered yet. */
    estimateSize: number;
    /** Lists shorter than this render every item. */
    threshold?: number;
    tag?: string;
    itemTag?: string;
    itemClass?: string;
  }>(),
  {
    threshold: VIRTUAL_LIST_THRESHOLD,
    tag: 'div',
    itemTag: 'div',
    itemClass: undefined
  }
);

defineSlots<{
  default(props: { item: T; index: number }): unknown;
}>();

// -------------------------------------------------- Refs --------------------------------------------------
const containerRef = ref<HTMLElement | null>(null);

const { bVirtual, visibleEntries, padTop, padBottom } = useVirtualList<T>(containerRef, {
  items: () => props.items,
  itemKey: (item) => props.itemKey(item),
  estimateSize: () => props.estimateSize,
  threshold: () => props.threshold
});

// -------------------------------------------------- Computed --------------------------------------------------
const containerStyle = computed(() =>
  bVirtual.value
    ? { paddingTop: `${padTop.value}px`, paddingBottom: `${padBottom.value}px` }
    : undefined
);
</script>

<template>
  <component :is="tag" ref="containerRef" :style="containerStyle">
    <component
      :is="itemTag"
      v-for="entry in visibleEntries"
      :key="entry.key"
      :data-vl-key="entry.key"
      :class="itemClass"
      :style="{ '--stagger-index': entry.index }"
    >
      <slot :item="entry.item" :index="entry.index" />
    </component>
  </component>
</template>
