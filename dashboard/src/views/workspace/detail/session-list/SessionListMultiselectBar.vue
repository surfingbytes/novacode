<script setup lang="ts">
// -------------------------------------------------- Props --------------------------------------------------
defineProps<{
  bVisible: boolean;
  totalCount: number;
  bAllSelected: boolean;
  bBulkArchiving: boolean;
  bShouldUnarchive: boolean;
  bHasSelection: boolean;
  left: number | null;
  width: number | null;
}>();

// -------------------------------------------------- Emits --------------------------------------------------
const emit = defineEmits<{
  toggleSelectAll: [];
  archive: [];
  delete: [];
}>();
</script>

<template>
  <Transition name="fade">
    <div
      v-if="bVisible"
      class="fixed bottom-4 z-40 bg-surface border border-border rounded-xl px-3 py-2 shadow-xl"
      :class="left === null ? 'left-1/2 -translate-x-1/2 w-[min(960px,calc(100%-1rem))]' : ''"
      :style="
        left === null
          ? undefined
          : {
              left: `${left}px`,
              width: `${width ?? 0}px`,
              transform: 'translateX(0)'
            }
      "
    >
      <div class="flex flex-wrap items-center justify-between gap-y-2 gap-x-3 w-full">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-2 min-w-0">
          <span class="text-sm text-text-muted whitespace-nowrap">
            {{ totalCount }} item{{ totalCount === 1 ? '' : 's' }}
          </span>
          <button type="button" class="button" @click="emit('toggleSelectAll')">
            {{ bAllSelected ? 'Clear all' : 'Select all' }}
          </button>
        </div>
        <div class="flex items-center gap-2 shrink-0 ml-auto">
          <button
            v-if="bHasSelection"
            type="button"
            class="button is-icon hover:bg-warning/10! hover:border-warning!"
            :disabled="bBulkArchiving"
            @click="emit('archive')"
            :aria-label="bShouldUnarchive ? 'Unarchive selected' : 'Archive selected'"
            :title="bShouldUnarchive ? 'Unarchive selected' : 'Archive selected'"
          >
            <svg
              v-if="bShouldUnarchive"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              width="14"
              height="14"
              class="text-warning"
              aria-hidden="true"
            >
              <path
                d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M12 12v4M10 14l2-2 2 2"
              />
            </svg>
            <svg
              v-else
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              width="14"
              height="14"
              class="text-warning"
              aria-hidden="true"
            >
              <path
                d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4"
              />
            </svg>
          </button>
          <button
            v-if="bHasSelection"
            type="button"
            class="button is-icon is-primary"
            @click="emit('delete')"
            aria-label="Delete selected"
            title="Delete selected"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              width="14"
              height="14"
              aria-hidden="true"
            >
              <path
                d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
