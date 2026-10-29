<script setup lang="ts" generic="T">
// node_modules
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

// components
import VirtualList from '@/components/ui/VirtualList.vue';

// utils
import { chunkRows, gridColumnCount, VIRTUAL_LIST_THRESHOLD } from '@/utils/virtualWindow';

// -------------------------------------------------- Props --------------------------------------------------
const props = withDefaults(
  defineProps<{
    items: readonly T[];
    itemKey: (item: T) => string;
    /** Height (px) of one grid row including the row gap. */
    estimateRowSize: number;
    /** Class of the grid element; must lay out `repeat(auto-fill, minmax(min(minColumnWidth, 100%), 1fr))`. */
    gridClass: string;
    minColumnWidth?: number;
    gap?: number;
    /** Grids with fewer items render every item in a single grid. */
    threshold?: number;
  }>(),
  {
    minColumnWidth: 384,
    gap: 16,
    threshold: VIRTUAL_LIST_THRESHOLD
  }
);

defineSlots<{
  default(props: { item: T; index: number }): unknown;
}>();

// -------------------------------------------------- Refs --------------------------------------------------
const rootRef = ref<HTMLElement | null>(null);
const containerWidth = ref(0);
let resizeObserver: ResizeObserver | null = null;

// -------------------------------------------------- Computed --------------------------------------------------
const bVirtual = computed(() => props.items.length >= props.threshold);

const columns = computed(() =>
  gridColumnCount(containerWidth.value, props.minColumnWidth, props.gap)
);

/** Rows of items, each remembering the index of its first item. */
const rows = computed(() =>
  chunkRows(props.items, columns.value).map((rowItems, rowIndex) => ({
    items: rowItems,
    start: rowIndex * columns.value
  }))
);

const rowStyle = computed(() => ({
  gridTemplateColumns: `repeat(${columns.value}, minmax(0, 1fr))`,
  paddingBottom: `${props.gap}px`
}));

// -------------------------------------------------- Methods --------------------------------------------------
/** Rows keyed by position: reordering items re-patches rows instead of remounting them. */
function rowKey(row: { start: number }): string {
  return `row-${row.start}`;
}

function updateWidth(): void {
  containerWidth.value = rootRef.value?.clientWidth ?? 0;
}

// -------------------------------------------------- Lifecycle --------------------------------------------------
onMounted(() => {
  updateWidth();
  if (typeof ResizeObserver !== 'undefined' && rootRef.value) {
    resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(rootRef.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <div ref="rootRef">
    <VirtualList
      v-if="bVirtual"
      :items="rows"
      :item-key="rowKey"
      :estimate-size="estimateRowSize"
      :threshold="0"
    >
      <template #default="{ item: row }">
        <div :class="gridClass" :style="rowStyle">
          <template v-for="(item, i) in row.items" :key="itemKey(item)">
            <slot :item="item" :index="row.start + i" />
          </template>
        </div>
      </template>
    </VirtualList>
    <div v-else :class="gridClass">
      <template v-for="(item, index) in items" :key="itemKey(item)">
        <slot :item="item" :index="index" />
      </template>
    </div>
  </div>
</template>
