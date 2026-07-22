<script setup lang="ts">
// node_modules
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

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
        <!-- Legacy parity: active grid cards used the generic chat icon; only
             archived grid cards showed the orchestrator icon. -->
        <svg
          v-if="bArchived"
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
        <svg
          v-else
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
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      </div>
      <div class="info">
        <p class="title flex items-center gap-2">
          <span>{{ orchestrator.name }}</span>
          <!-- Legacy parity: active grid cards never showed a running badge. -->
          <span
            v-if="bArchived && orchestrator.runStatus === 'running'"
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
        <!-- Legacy parity: orchestrator edit is not wired up; the active-card
             button is a no-op placeholder. -->
        <button
          v-if="!bArchived"
          type="button"
          class="button is-icon"
          aria-label="Edit orchestrator"
          @click.prevent.stop
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
            <path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6" />
            <path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z" />
          </svg>
        </button>
        <button
          v-if="bArchived"
          type="button"
          class="button is-icon"
          title="Unarchive"
          aria-label="Unarchive orchestrator"
          @click.prevent.stop="emit('archive')"
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
            class="text-primary"
            aria-hidden="true"
          >
            <path
              d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M12 12v4M10 14l2-2 2 2"
            />
          </svg>
        </button>
        <button
          v-else
          type="button"
          class="button is-icon hover:bg-warning/10! hover:border-warning!"
          aria-label="Archive orchestrator"
          @click.prevent.stop="emit('archive')"
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
            class="text-warning"
            aria-hidden="true"
          >
            <path
              d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4"
            />
          </svg>
        </button>
        <button
          type="button"
          class="button is-icon hover:bg-destructive/10! hover:border-destructive!"
          aria-label="Delete orchestrator"
          @click.prevent.stop="emit('delete')"
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
            class="text-destructive"
            aria-hidden="true"
          >
            <path
              d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
            />
          </svg>
        </button>
      </div>
    </div>

    <!-- List layout -->
    <template v-else>
      <div class="cell !flex-none pr-0">
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
        <p class="title flex items-center gap-2">
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
      </div>
      <div class="cell">
        <p class="tag" :class="AGENT_TYPE_TAG_COLOR[orchestrator.agentType]">
          {{ agentTypeLabel(orchestrator.agentType) }}
        </p>
      </div>
      <div class="cell buttons">
        <!-- Legacy parity: orchestrator edit is not wired up; the active-card
             button is a no-op placeholder. -->
        <button
          v-if="!bArchived"
          type="button"
          class="button is-icon"
          aria-label="Edit orchestrator"
          @click.prevent.stop
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
            <path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6" />
            <path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z" />
          </svg>
        </button>
        <button
          v-if="bArchived"
          type="button"
          class="button is-icon"
          title="Unarchive"
          aria-label="Unarchive orchestrator"
          @click.prevent.stop="emit('archive')"
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
            class="text-primary"
            aria-hidden="true"
          >
            <path
              d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M12 12v4M10 14l2-2 2 2"
            />
          </svg>
        </button>
        <button
          v-else
          type="button"
          class="button is-icon hover:bg-warning/10! hover:border-warning!"
          aria-label="Archive orchestrator"
          @click.prevent.stop="emit('archive')"
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
            class="text-warning"
            aria-hidden="true"
          >
            <path
              d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4"
            />
          </svg>
        </button>
        <button
          type="button"
          class="button is-icon hover:bg-destructive/10! hover:border-destructive!"
          aria-label="Delete orchestrator"
          @click.prevent.stop="emit('delete')"
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
            class="text-destructive"
            aria-hidden="true"
          >
            <path
              d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
            />
          </svg>
        </button>
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
