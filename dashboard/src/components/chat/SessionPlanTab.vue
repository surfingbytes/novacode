<script setup lang="ts">
/**
 * Plan tab: document header, actions menu, rendered markdown, and plan-points
 * list. Extracted from SessionChat.vue; plan fetch/selection state stays in
 * the parent (usePlanDocuments).
 */

// node_modules
import { onMounted, onUnmounted, ref } from 'vue';
import { ChevronDown } from 'lucide-vue-next';

// utils
import {
  isPlanEntryCompleted,
  planStatusIcon,
  type PlanDocument,
  type PlanEntry
} from '@/utils/chatDisplayItems';

// -------------------------------------------------- Props --------------------------------------------------

defineProps<{
  planDocuments: PlanDocument[];
  selectedPlanDocument: PlanDocument | null;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'select', planId: string): void;
  (e: 'download', plan: PlanDocument): void;
  (e: 'delete'): void;
  (e: 'start-full-plan', plan: PlanDocument): void;
  (e: 'start-plan-entry', payload: { plan: PlanDocument; entry: PlanEntry; index: number }): void;
  (e: 'markdown-click', event: MouseEvent): void;
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const bPlanActionsMenuOpen = ref(false);
const planActionsMenuRef = ref<HTMLElement | null>(null);

// -------------------------------------------------- Methods --------------------------------------------------

function closePlanActionsMenu(): void {
  bPlanActionsMenuOpen.value = false;
}

function onSelectPlan(planId: string): void {
  emit('select', planId);
}

function onDownload(plan: PlanDocument): void {
  closePlanActionsMenu();
  emit('download', plan);
}

function onDelete(): void {
  closePlanActionsMenu();
  emit('delete');
}

function onStartFullPlan(plan: PlanDocument): void {
  closePlanActionsMenu();
  emit('start-full-plan', plan);
}

function onStartPlanEntry(plan: PlanDocument, entry: PlanEntry, index: number): void {
  emit('start-plan-entry', { plan, entry, index });
}

function handleDocumentClick(e: MouseEvent): void {
  const planActionsEl = planActionsMenuRef.value;
  if (bPlanActionsMenuOpen.value && planActionsEl && !planActionsEl.contains(e.target as Node)) {
    closePlanActionsMenu();
  }
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && bPlanActionsMenuOpen.value) closePlanActionsMenu();
}

// -------------------------------------------------- Lifecycle --------------------------------------------------

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick);
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="flex-1 min-h-0 overflow-hidden flex flex-col bg-bg">
    <div
      class="shrink-0 border-b border-fg/10 px-4 md:px-6 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
    >
      <div class="min-w-0 sm:flex-1">
        <div v-if="planDocuments.length <= 1" class="flex items-center gap-2">
          <span class="truncate text-sm font-semibold text-text-primary">
            {{ selectedPlanDocument?.title ?? 'Plan' }}
          </span>
          <span
            v-if="selectedPlanDocument?.live"
            class="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
          >
            Live
          </span>
        </div>
        <div v-if="selectedPlanDocument" class="text-xs text-text-muted whitespace-nowrap">
          <template v-if="selectedPlanDocument.startableEntries.length">
            {{ selectedPlanDocument.completedCount }}/{{
              selectedPlanDocument.startableEntries.length
            }}
            completed
          </template>
          <template v-else>Plan document</template>
        </div>
      </div>

      <div class="flex min-w-0 items-center gap-2 sm:ml-auto sm:shrink-0">
        <select
          v-if="planDocuments.length > 1"
          class="min-w-0 flex-1 max-w-none rounded-md border border-fg/15 bg-bg px-2 py-1 text-xs text-text-primary outline-none focus:border-primary sm:max-w-[12rem] sm:flex-none"
          :value="selectedPlanDocument?.id"
          aria-label="Select plan document"
          @change="onSelectPlan(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="plan in planDocuments" :key="plan.id" :value="plan.id">
            {{ plan.title }}{{ plan.live ? ' (live)' : '' }}
          </option>
        </select>

        <div
          v-if="selectedPlanDocument"
          ref="planActionsMenuRef"
          class="relative inline-flex shrink-0"
        >
          <button
            type="button"
            class="button is-transparent rounded-r-none! text-xs"
            title="Download plan as Markdown"
            @click="onDownload(selectedPlanDocument)"
          >
            Download
          </button>
          <button
            type="button"
            class="button is-transparent is-icon rounded-l-none! border-l border-fg/10"
            title="Plan actions"
            aria-label="Plan actions"
            @click.stop="bPlanActionsMenuOpen = !bPlanActionsMenuOpen"
          >
            <ChevronDown class="h-3.5 w-3.5" />
          </button>
          <div
            v-if="bPlanActionsMenuOpen"
            class="absolute right-0 top-full z-30 mt-1 min-w-56 overflow-hidden rounded-lg border border-fg/10 bg-surface shadow-xl"
          >
            <button
              type="button"
              class="flex w-full items-center px-3 py-2 text-left text-xs text-text-primary hover:bg-fg/[0.06]"
              @click="onStartFullPlan(selectedPlanDocument)"
            >
              Start whole plan in new session
            </button>
            <button
              type="button"
              class="flex w-full items-center px-3 py-2 text-left text-xs text-text-primary hover:bg-fg/[0.06]"
              @click="onDownload(selectedPlanDocument)"
            >
              Download markdown
            </button>
            <button
              type="button"
              class="flex w-full items-center px-3 py-2 text-left text-xs text-red-400 hover:bg-fg/[0.06]"
              @click="onDelete"
            >
              Delete plan
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-6">
      <div v-if="selectedPlanDocument" class="mx-auto flex max-w-3xl flex-col gap-4">
        <div class="rounded-2xl border border-fg/10 bg-fg/[0.03] px-5 py-4 md:px-8 md:py-6">
          <div
            class="chat-markdown plan-markdown text-sm text-text-primary"
            v-html="selectedPlanDocument.renderedHtml"
            @click="emit('markdown-click', $event)"
          ></div>
        </div>
        <div
          v-if="selectedPlanDocument.startableEntries.length"
          class="rounded-2xl border border-fg/10 bg-fg/[0.03] overflow-hidden"
        >
          <div class="flex items-center gap-2 border-b border-fg/10 px-4 py-2.5">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="select-none text-text-muted shrink-0"
              aria-hidden="true"
            >
              <path
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12l2 2 4-4"
              />
            </svg>
            <span class="text-xs font-medium text-text-primary">Plan points</span>
            <span class="ml-auto text-xs text-text-muted">
              {{ selectedPlanDocument.completedCount }}/{{
                selectedPlanDocument.startableEntries.length
              }}
            </span>
          </div>
          <ul class="space-y-1.5 px-4 py-3">
            <li
              v-for="(entry, index) in selectedPlanDocument.startableEntries"
              :key="`${selectedPlanDocument.id}-todo-${index}`"
              class="flex items-start gap-2 text-xs"
            >
              <svg
                v-if="planStatusIcon(entry.status) === 'completed'"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="text-green-500 select-none shrink-0 mt-px"
                aria-hidden="true"
              >
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <svg
                v-else-if="planStatusIcon(entry.status) === 'in_progress'"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="text-primary select-none shrink-0 mt-px"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <svg
                v-else
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="text-text-muted select-none shrink-0 mt-px"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
              </svg>
              <span
                class="min-w-0 flex-1 leading-snug"
                :class="
                  isPlanEntryCompleted(entry.status)
                    ? 'text-text-muted line-through'
                    : 'text-text-primary'
                "
              >
                {{ entry.content }}
              </span>
              <button
                type="button"
                class="shrink-0 rounded-md border border-fg/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
                title="Start a new session from this plan point"
                @click="onStartPlanEntry(selectedPlanDocument, entry, index)"
              >
                Start session
              </button>
            </li>
          </ul>
        </div>
      </div>
      <div v-else class="h-full flex items-center justify-center text-sm text-text-muted">
        No plan has been created for this session yet.
      </div>
    </div>
  </div>
</template>

<style scoped>
.plan-markdown {
  line-height: 1.65;
}

.plan-markdown :deep(h1),
.plan-markdown :deep(h2),
.plan-markdown :deep(h3) {
  color: var(--color-text-primary);
  font-weight: 700;
  line-height: 1.25;
}

.plan-markdown :deep(h1) {
  margin: 0 0 1rem;
  font-size: 1.5rem;
}

.plan-markdown :deep(h2) {
  margin: 1.5rem 0 0.65rem;
  padding-top: 0.75rem;
  border-top: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  font-size: 1.125rem;
}

.plan-markdown :deep(h3) {
  margin: 1.15rem 0 0.5rem;
  font-size: 0.98rem;
}

.plan-markdown :deep(p),
.plan-markdown :deep(ul),
.plan-markdown :deep(ol),
.plan-markdown :deep(blockquote),
.plan-markdown :deep(pre) {
  margin: 0.65rem 0;
}

.plan-markdown :deep(ul),
.plan-markdown :deep(ol) {
  padding-left: 1.25rem;
}

.plan-markdown :deep(ul) {
  list-style: disc;
}

.plan-markdown :deep(ol) {
  list-style: decimal;
}

.plan-markdown :deep(li) {
  margin: 0.35rem 0;
  padding-left: 0.15rem;
}

.plan-markdown :deep(.plan-start-action-inline) {
  margin: -0.25rem 0 0.75rem;
}

.plan-markdown :deep(.plan-start-session-btn) {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  border: 1px solid color-mix(in srgb, var(--color-primary) 25%, transparent);
  border-radius: 0.45rem;
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  padding: 0.3rem 0.5rem;
  color: var(--color-primary);
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1;
  vertical-align: middle;
}

.plan-markdown :deep(.plan-start-session-btn:hover) {
  background: color-mix(in srgb, var(--color-primary) 16%, transparent);
}

.plan-markdown :deep(strong) {
  color: var(--color-text-primary);
  font-weight: 700;
}

.plan-markdown :deep(blockquote) {
  border-left: 3px solid color-mix(in srgb, var(--color-fg) 18%, transparent);
  padding-left: 0.9rem;
  color: var(--color-text-muted);
}

.plan-markdown :deep(code) {
  border-radius: 0.35rem;
  background: color-mix(in srgb, var(--color-fg) 8%, transparent);
  padding: 0.1rem 0.3rem;
  font-size: 0.86em;
}

.plan-markdown :deep(pre) {
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--color-fg) 6%, transparent);
  padding: 0.85rem 1rem;
}

.plan-markdown :deep(pre code) {
  background: transparent;
  padding: 0;
}
</style>
