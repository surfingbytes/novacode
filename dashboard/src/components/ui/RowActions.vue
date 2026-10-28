<script setup lang="ts">
// node_modules
import { computed } from 'vue';

// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(
  defineProps<{
    showEdit?: boolean;
    showArchive?: boolean;
    showDelete?: boolean;
    /** Archive button becomes Unarchive. */
    archived?: boolean;
    size?: 'sm' | 'md';
  }>(),
  {
    showEdit: true,
    showArchive: true,
    showDelete: true,
    archived: false,
    size: 'md'
  }
);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  edit: [];
  archive: [];
  delete: [];
}>();

// -------------------------------------------------- Computed --------------------------------------------------

const iconSize = computed(() => (props.size === 'sm' ? 12 : 14));
const archiveLabel = computed(() => (props.archived ? 'Unarchive' : 'Archive'));
</script>

<template>
  <button
    v-if="showEdit"
    type="button"
    class="button is-icon"
    title="Edit"
    aria-label="Edit"
    @click.prevent.stop="emit('edit')"
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      :width="iconSize"
      :height="iconSize"
      aria-hidden="true"
    >
      <path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6" />
      <path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z" />
    </svg>
  </button>
  <button
    v-if="showArchive"
    type="button"
    class="button is-icon"
    :class="{ 'hover:bg-warning/10! hover:border-warning!': !archived }"
    :title="archiveLabel"
    :aria-label="archiveLabel"
    @click.prevent.stop="emit('archive')"
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      :width="iconSize"
      :height="iconSize"
      :class="archived ? 'text-primary' : 'text-warning'"
      aria-hidden="true"
    >
      <path
        v-if="archived"
        d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M12 12v4M10 14l2-2 2 2"
      />
      <path
        v-else
        d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4"
      />
    </svg>
  </button>
  <button
    v-if="showDelete"
    type="button"
    class="button is-icon hover:bg-destructive/10! hover:border-destructive!"
    title="Delete"
    aria-label="Delete"
    @click.prevent.stop="emit('delete')"
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      :width="iconSize"
      :height="iconSize"
      class="text-destructive"
      aria-hidden="true"
    >
      <path
        d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
      />
    </svg>
  </button>
</template>
