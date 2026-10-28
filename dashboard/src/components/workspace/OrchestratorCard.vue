<script setup lang="ts">
// node_modules
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

// components
import RowActions from '@/components/ui/RowActions.vue';

// utils
import { agentTypeLabel } from '@/utils/agentTypeMeta';
import { AGENT_TYPE_TAG_COLOR } from '@/components/workspace/agentTypeTagColor';

// types
import type { Orchestrator } from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(
  defineProps<{
    orchestrator: Orchestrator;
    /** Workspace route id used to build the card link. */
    workspaceId: string;
    /** Card is checked in multiselect mode. */
    bSelected?: boolean;
    /** Multiselect mode is active (at least one item selected). */
    bSelectionActive?: boolean;
    /** Grid (card) layout when true, list-row layout otherwise. */
    bGrid?: boolean;
    /** Archived styling: dimmed card, unarchive action instead of edit/archive. */
    bArchived?: boolean;
  }>(),
  {
    bSelected: false,
    bSelectionActive: false,
    bGrid: false,
    bArchived: false
  }
);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  archive: [];
  delete: [];
  toggleSelect: [];
}>();

// -------------------------------------------------- Computed --------------------------------------------------

const linkTo = computed(() => ({
  name: 'orchestrator',
  params: { id: props.workspaceId, orchestratorId: props.orchestrator.id }
}));

const rootClass = computed(() => {
  const classes = [props.bGrid ? 'grid-item' : 'list-item'];
  if (props.bArchived) {
    classes.push('opacity-60 hover:opacity-80 transition-opacity');
  }
  return classes.join(' ');
});
</script>

<template>
  <RouterLink class="group" :class="rootClass" :to="linkTo">
    <!-- Grid layout -->
    <div v-if="bGrid" class="top">
      <div class="icon">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <path d="M21 3H15v4h6V3zM9 3H3v4h6V3zM15 17H9v4h6v-4z" />
          <path d="M12 7v4M6 7v6h12V7" />
        </svg>
      </div>
      <div class="info">
        <p class="title flex items-center gap-2">
          <span>{{ orchestrator.name }}</span>
          <span
            v-if="orchestrator.runStatus === 'running'"
            class="busy-badge text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
            title="Orchestrator is running"
          >
            <span class="busy-spinner"></span>
            Running
          </span>
        </p>
        <p class="tag" :class="AGENT_TYPE_TAG_COLOR[orchestrator.agentType]">
          {{ agentTypeLabel(orchestrator.agentType) }}
        </p>
      </div>
      <div class="buttons">
        <RowActions
          :show-edit="false"
          :archived="bArchived"
          @archive="emit('archive')"
          @delete="emit('delete')"
        />
      </div>
    </div>

    <!-- List layout -->
    <template v-else>
      <div class="cell shrink-0" :class="{ 'max-sm:hidden': !bSelectionActive && !bSelected }">
        <button
          type="button"
          class="w-6 h-6 rounded border border-border bg-bg/90 text-primary flex items-center justify-center"
          :aria-label="bSelected ? 'Deselect orchestrator' : 'Select orchestrator'"
          @click.prevent.stop="emit('toggleSelect')"
        >
          <svg
            v-if="bSelected"
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
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
      </div>
      <div class="cell flex-1 min-w-0">
        <p class="title flex flex-wrap items-center gap-x-2 gap-y-1">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            width="16"
            height="16"
            class="text-text-muted shrink-0"
            aria-hidden="true"
          >
            <path d="M21 3H15v4h6V3zM9 3H3v4h6V3zM15 17H9v4h6v-4z" />
            <path d="M12 7v4M6 7v6h12V7" />
          </svg>
          <span class="break-words">{{ orchestrator.name }}</span>
          <span
            v-if="orchestrator.runStatus === 'running'"
            class="busy-badge text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 shrink-0"
            title="Orchestrator is running"
          >
            <span class="busy-spinner"></span>
            Running
          </span>
          <span class="tag shrink-0" :class="AGENT_TYPE_TAG_COLOR[orchestrator.agentType]">
            {{ agentTypeLabel(orchestrator.agentType) }}
          </span>
        </p>
      </div>
      <div class="cell buttons">
        <RowActions
          :show-edit="false"
          :archived="bArchived"
          @archive="emit('archive')"
          @delete="emit('delete')"
        />
      </div>
    </template>
  </RouterLink>
</template>

<style scoped>
.busy-badge {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary) 25%, transparent);
  animation: busy-glow 2s ease-in-out infinite;
}

@keyframes busy-glow {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-primary) 0%, transparent);
  }
  50% {
    box-shadow: 0 0 8px 2px color-mix(in srgb, var(--color-primary) 25%, transparent);
  }
}

.busy-spinner {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  border-top-color: var(--color-primary);
  animation: busy-spin 0.8s linear infinite;
}

@keyframes busy-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
