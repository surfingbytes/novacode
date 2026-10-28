<script setup lang="ts">
// node_modules
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

// components
import RowActions from '@/components/ui/RowActions.vue';
import StatusBadge from '@/components/ui/StatusBadge.vue';

// utils
import { agentTypeLabel } from '@/utils/agentTypeMeta';
import { tagColorClass } from '@/utils/tagColors';
import { AGENT_TYPE_TAG_COLOR } from '@/components/workspace/agentTypeTagColor';
import { isSessionUnread } from '@/utils/sessionUnread';
import { sessionBusyLabel, sessionBusyTitle } from '@/utils/sessionBusyLabel';

// types
import type { Session } from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(
  defineProps<{
    session: Session;
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
    /** Nested step-session row under an orchestrator (list layout only). */
    bNested?: boolean;
  }>(),
  {
    bSelected: false,
    bSelectionActive: false,
    bGrid: false,
    bArchived: false,
    bNested: false
  }
);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  edit: [];
  archive: [];
  delete: [];
  toggleSelect: [];
}>();

// -------------------------------------------------- Computed --------------------------------------------------

const linkTo = computed(() => ({
  name: 'session',
  params: { id: props.workspaceId, sessionId: props.session.id }
}));

const bUnread = computed(() => isSessionUnread(props.session));

const rootClass = computed(() => {
  const classes = [props.bGrid ? 'grid-item' : 'list-item'];
  if (props.bNested) {
    classes.push('bg-fg/[0.02] border-l-2 border-l-primary/25 ml-4 pl-2 !cursor-pointer');
  }
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
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      </div>
      <div class="info">
        <p class="title flex items-center gap-2">
          <span>{{ session.name }}</span>
          <svg
            v-if="session.isFavorite"
            class="text-primary shrink-0"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="currentColor"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-label="Favorite"
            title="Favorite"
          >
            <path
              d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"
            />
          </svg>
          <span
            v-if="session.busy"
            class="busy-badge text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
            :title="sessionBusyTitle(session)"
          >
            <span class="busy-spinner"></span>
            {{ sessionBusyLabel(session) }}
          </span>
          <StatusBadge v-else-if="bUnread" kind="done" title="Finished — unread" />
        </p>
        <p class="tag" :class="AGENT_TYPE_TAG_COLOR[session.agentType]">
          {{ agentTypeLabel(session.agentType) }}
        </p>
        <div v-if="session.tags?.length" class="flex flex-wrap gap-1 mt-2">
          <span
            v-for="tag in session.tags"
            :key="tag"
            class="text-xs px-2 py-0.5 rounded-full border font-medium"
            :class="tagColorClass(tag)"
          >
            {{ tag }}
          </span>
        </div>
      </div>
      <div class="buttons">
        <RowActions
          :show-edit="!bArchived"
          :archived="bArchived"
          @edit="emit('edit')"
          @archive="emit('archive')"
          @delete="emit('delete')"
        />
      </div>
    </div>

    <!-- List layout: nested step-session row (no checkbox, no actions) -->
    <template v-else-if="bNested">
      <div class="cell flex-1 min-w-0 flex items-start gap-2">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          width="14"
          height="14"
          class="text-text-muted shrink-0 mt-0.5"
          aria-hidden="true"
        >
          <path d="M3 9l9 9 9-9" />
        </svg>
        <div class="min-w-0 flex-1">
          <p class="title flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="break-words">{{ session.name }}</span>
            <span
              v-if="session.busy"
              class="busy-badge text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 shrink-0"
              :title="sessionBusyTitle(session)"
            >
              <span class="busy-spinner"></span>
              {{ sessionBusyLabel(session) }}
            </span>
            <StatusBadge v-else-if="bUnread" kind="done" title="Finished — unread" />
            <span class="tag shrink-0" :class="AGENT_TYPE_TAG_COLOR[session.agentType]">
              {{ agentTypeLabel(session.agentType) }}
            </span>
          </p>
          <div v-if="session.tags?.length" class="flex flex-wrap gap-1 mt-1">
            <span
              v-for="tag in session.tags"
              :key="tag"
              class="text-xs px-2 py-0.5 rounded-full border font-medium"
              :class="tagColorClass(tag)"
            >
              {{ tag }}
            </span>
          </div>
        </div>
      </div>
    </template>

    <!-- List layout -->
    <template v-else>
      <div class="cell shrink-0" :class="{ 'max-sm:hidden': !bSelectionActive && !bSelected }">
        <button
          type="button"
          class="w-6 h-6 rounded border border-border bg-bg/90 text-primary flex items-center justify-center"
          :aria-label="bSelected ? 'Deselect session' : 'Select session'"
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
          <span class="break-words">{{ session.name }}</span>
          <svg
            v-if="session.isFavorite"
            class="text-primary shrink-0"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="currentColor"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-label="Favorite"
            title="Favorite"
          >
            <path
              d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"
            />
          </svg>
          <span
            v-if="session.busy"
            class="busy-badge text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 shrink-0"
            :title="sessionBusyTitle(session)"
          >
            <span class="busy-spinner"></span>
            {{ sessionBusyLabel(session) }}
          </span>
          <StatusBadge v-else-if="bUnread" kind="done" title="Finished — unread" />
          <span class="tag shrink-0" :class="AGENT_TYPE_TAG_COLOR[session.agentType]">
            {{ agentTypeLabel(session.agentType) }}
          </span>
        </p>
        <div v-if="session.tags?.length" class="flex flex-wrap gap-1 mt-1">
          <span
            v-for="tag in session.tags"
            :key="tag"
            class="text-xs px-2 py-0.5 rounded-full border font-medium"
            :class="tagColorClass(tag)"
          >
            {{ tag }}
          </span>
        </div>
      </div>
      <div class="cell buttons">
        <RowActions
          :show-edit="!bArchived"
          :archived="bArchived"
          @edit="emit('edit')"
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
