<script setup lang="ts">
// node_modules
import { computed } from 'vue';

// types
import type { Automation } from '@/@types/index';

// utils
import { agentTypeChipClass, agentTypeLabel, agentTypeShortLabel } from '@/utils/agentTypeMeta';
import { formatDate, formatInterval, formatNextRun } from '@/components/automations/automationFormat';

// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(
  defineProps<{
    automation: Automation;
    /** Grid (card) layout when true, list-row layout otherwise. */
    bGrid?: boolean;
    /** Display name of the automation's workspace (resolved by the parent). */
    workspaceName: string;
    /** Whether this automation is selected in the run-report panel. */
    bSelected?: boolean;
    /** A manual trigger is currently in flight for this automation. */
    bTriggering?: boolean;
  }>(),
  {
    bGrid: false,
    bSelected: false,
    bTriggering: false
  }
);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  select: [];
  edit: [];
  toggle: [];
  trigger: [];
  delete: [];
}>();

// -------------------------------------------------- Computed --------------------------------------------------

/** Mono meta line, e.g. `ws name · every 1w · next in 2d · last 7/21/2026, …` */
const metaLine = computed(() => {
  const parts = [
    props.workspaceName,
    `every ${formatInterval(props.automation.intervalMinutes)}`,
    `next ${formatNextRun(props.automation)}`
  ];
  if (props.automation.lastRunAt) {
    parts.push(`last ${formatDate(props.automation.lastRunAt)}`);
  }
  return parts.join(' · ');
});
</script>

<template>
  <!-- Grid card -->
  <article
    v-if="bGrid"
    class="group grid-item cursor-pointer"
    :class="{ 'ring-1 ring-inset ring-primary/30 bg-primary/[0.02]': bSelected }"
    @click="emit('select')"
  >
    <div class="top">
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
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </div>
      <div class="info min-w-0">
        <p class="title truncate">{{ automation.name }}</p>
        <p class="nc-mono text-[11px] text-text-muted mt-1 truncate">{{ metaLine }}</p>
        <p class="text-xs text-text-muted mt-1 truncate opacity-70">{{ automation.prompt }}</p>
        <div class="flex items-center gap-2 mt-2">
          <span
            class="text-[10px] px-1.5 py-0.5 rounded font-medium"
            :class="automation.enabled ? 'bg-green-500/15 text-green-400' : 'bg-fg/10 text-text-muted'"
          >
            {{ automation.enabled ? 'active' : 'disabled' }}
          </span>
          <span
            class="nc-chip"
            :class="agentTypeChipClass(automation.agentType)"
            :title="agentTypeLabel(automation.agentType)"
          >
            {{ agentTypeShortLabel(automation.agentType) }}
          </span>
        </div>
      </div>
      <div class="buttons" @click.stop>
        <button
          type="button"
          class="button is-icon is-transparent"
          :title="automation.enabled ? 'Disable' : 'Enable'"
          :aria-label="automation.enabled ? 'Disable' : 'Enable'"
          @click="emit('toggle')"
        >
          <svg
            v-if="automation.enabled"
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
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
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
            aria-hidden="true"
          >
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </button>
        <button
          type="button"
          class="button is-icon is-transparent"
          title="Run now"
          aria-label="Run now"
          :disabled="bTriggering"
          @click="emit('trigger')"
        >
          <span
            v-if="bTriggering"
            class="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin block"
          />
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
            aria-hidden="true"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </button>
        <button
          type="button"
          class="button is-icon is-transparent"
          title="Edit"
          aria-label="Edit"
          @click="emit('edit')"
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
          type="button"
          class="button is-icon is-transparent is-delete"
          title="Delete"
          aria-label="Delete"
          @click="emit('delete')"
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
  </article>

  <!-- List row -->
  <li
    v-else
    class="px-4 py-3 hover:bg-fg/[0.03] transition-colors cursor-pointer"
    :class="{ 'ring-1 ring-inset ring-primary/30 bg-primary/[0.02]': bSelected }"
    @click="emit('select')"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap">
          <p class="text-sm font-medium text-text-primary truncate">{{ automation.name }}</p>
          <span
            class="text-[10px] px-1.5 py-0.5 rounded font-medium"
            :class="automation.enabled ? 'bg-green-500/15 text-green-400' : 'bg-fg/10 text-text-muted'"
          >
            {{ automation.enabled ? 'active' : 'disabled' }}
          </span>
          <span
            class="nc-chip"
            :class="agentTypeChipClass(automation.agentType)"
            :title="agentTypeLabel(automation.agentType)"
          >
            {{ agentTypeShortLabel(automation.agentType) }}
          </span>
        </div>
        <p class="nc-mono text-[11px] text-text-muted mt-1 truncate">{{ metaLine }}</p>
        <p class="text-xs text-text-muted mt-1 truncate opacity-70">{{ automation.prompt }}</p>
      </div>
      <!-- Actions -->
      <div class="flex items-center gap-1 shrink-0" @click.stop>
        <button
          type="button"
          :title="automation.enabled ? 'Disable' : 'Enable'"
          :aria-label="automation.enabled ? 'Disable' : 'Enable'"
          class="p-1.5 text-text-muted hover:text-text-primary hover:bg-fg/[0.06] rounded-lg transition-colors"
          @click="emit('toggle')"
        >
          <svg
            v-if="automation.enabled"
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
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
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
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </button>
        <button
          type="button"
          title="Run now"
          aria-label="Run now"
          class="p-1.5 text-text-muted hover:text-primary hover:bg-primary/[0.06] rounded-lg transition-colors"
          :disabled="bTriggering"
          @click="emit('trigger')"
        >
          <span
            v-if="bTriggering"
            class="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin block"
          />
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
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </button>
        <button
          type="button"
          title="Edit"
          aria-label="Edit"
          class="p-1.5 text-text-muted hover:text-text-primary hover:bg-fg/[0.06] rounded-lg transition-colors"
          @click="emit('edit')"
        >
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
            <path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6" />
            <path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z" />
          </svg>
        </button>
        <button
          type="button"
          title="Delete"
          aria-label="Delete"
          class="p-1.5 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
          @click="emit('delete')"
        >
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
            <path
              d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
            />
          </svg>
        </button>
      </div>
    </div>
  </li>
</template>
