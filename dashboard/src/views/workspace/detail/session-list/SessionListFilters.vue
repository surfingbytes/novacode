<script setup lang="ts">
// node_modules
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

// utils
import { agentSelectedStyle, agentTypeLabel } from '@/utils/agentTypeMeta';
import { emptySessionListFilter } from '@/utils/sessionListFilter';

// types
import type { AgentType } from '@/@types/index';
import type { SessionListFilter, SessionListStatusFilter } from '@/utils/sessionListFilter';

// -------------------------------------------------- Props --------------------------------------------------
const props = defineProps<{
  modelValue: SessionListFilter;
  tags: string[];
  agentTypes: AgentType[];
  counts: { busy: number; unread: number; idle: number };
}>();

// -------------------------------------------------- Emits --------------------------------------------------
const emit = defineEmits<{
  'update:modelValue': [filter: SessionListFilter];
}>();

// -------------------------------------------------- Data --------------------------------------------------
const statusOptions: Array<{ value: SessionListStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'busy', label: 'Busy' },
  { value: 'unread', label: 'Unread' },
  { value: 'idle', label: 'Idle' }
];
const segmentedClass =
  'inline-flex items-center rounded-md border border-border bg-input p-0.5 gap-0.5';
const optionClass =
  'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border transition-colors';
const triggerClass =
  'inline-flex items-center gap-1.5 text-xs px-2.5 h-[30px] border transition-colors';
const activeClass = 'bg-primary/15 text-primary border-primary/30';
const inactiveOptionClass = 'border-transparent text-text-muted hover:text-text-primary';
const inactiveTriggerClass = 'border-border bg-input text-text-muted hover:text-text-primary';
const tagsRootRef = ref<HTMLElement | null>(null);
const tagSearchRef = ref<HTMLInputElement | null>(null);
const bTagsOpen = ref(false);
const tagQuery = ref('');
/** Narrow screens only: filter row is collapsed behind a "Filters" button */
const bMobileFiltersOpen = ref(false);

// -------------------------------------------------- Computed --------------------------------------------------
const filteredTags = computed((): string[] => {
  const needle = tagQuery.value.trim().toLowerCase();
  if (!needle) {
    return props.tags;
  }
  return props.tags.filter((tag) => tag.toLowerCase().includes(needle));
});

/** Status/agent/tag filters in use (text has its own visible input) */
const activeFilterCount = computed((): number => {
  const { status, agentType, tag } = props.modelValue;
  return Number(status !== 'all') + Number(agentType !== null) + Number(tag !== null);
});

// -------------------------------------------------- Methods --------------------------------------------------
function update(patch: Partial<SessionListFilter>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch });
}

function statusCount(status: SessionListStatusFilter): number | null {
  if (status === 'all') {
    return null;
  }
  return props.counts[status];
}

function onTextInput(event: Event): void {
  update({ text: (event.target as HTMLInputElement).value });
}

function clearText(): void {
  update({ text: '' });
}

function clearFilters(): void {
  emit('update:modelValue', { ...emptySessionListFilter(), text: props.modelValue.text });
}

function toggleTagsMenu(): void {
  bTagsOpen.value = !bTagsOpen.value;
  if (bTagsOpen.value) {
    tagQuery.value = '';
    void nextTick(() => tagSearchRef.value?.focus());
  }
}

function chooseTag(tag: string | null): void {
  update({ tag });
  bTagsOpen.value = false;
}

function onTagSearchEnter(): void {
  const first = filteredTags.value[0];
  if (first) {
    chooseTag(first);
  }
}

function handleDocumentClick(event: MouseEvent): void {
  const el = tagsRootRef.value;
  if (bTagsOpen.value && el && !el.contains(event.target as Node)) {
    bTagsOpen.value = false;
  }
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && bTagsOpen.value) {
    event.stopPropagation();
    bTagsOpen.value = false;
  }
}

// -------------------------------------------------- Lifecycle --------------------------------------------------
onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleDocumentKeydown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick);
  document.removeEventListener('keydown', handleDocumentKeydown, true);
});
</script>

<template>
  <div class="flex flex-col gap-2 mb-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative flex-1 min-w-48">
        <input
          :value="modelValue.text"
          type="text"
          class="input w-full pr-8"
          placeholder="Filter sessions"
          aria-label="Filter sessions by name or tag"
          @input="onTextInput"
          @keydown.esc.prevent="clearText"
        />
        <button
          v-if="modelValue.text"
          type="button"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary"
          aria-label="Clear text filter"
          @click="clearText"
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
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <button
        type="button"
        class="button sm:hidden!"
        :class="{ 'text-primary!': activeFilterCount > 0 }"
        :aria-expanded="bMobileFiltersOpen"
        @click="bMobileFiltersOpen = !bMobileFiltersOpen"
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
          <path d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5z" />
        </svg>
        Filters
        <span v-if="activeFilterCount > 0" class="tabular-nums">({{ activeFilterCount }})</span>
      </button>
      <slot name="actions" />
    </div>

    <div
      class="flex-wrap items-center gap-x-3 gap-y-2"
      :class="bMobileFiltersOpen ? 'flex' : 'hidden sm:flex'"
    >
      <div :class="segmentedClass" role="group" aria-label="Filter by status">
        <button
          v-for="option in statusOptions"
          :key="option.value"
          type="button"
          :class="[
            optionClass,
            modelValue.status === option.value ? activeClass : inactiveOptionClass
          ]"
          :aria-pressed="modelValue.status === option.value"
          @click="update({ status: option.value })"
        >
          {{ option.label }}
          <span
            v-if="statusCount(option.value) !== null"
            class="tabular-nums"
            :class="statusCount(option.value) === 0 ? 'opacity-40' : 'opacity-70'"
          >
            {{ statusCount(option.value) }}
          </span>
        </button>
      </div>

      <template v-if="agentTypes.length >= 2">
        <span class="hidden sm:block w-px h-5 bg-border" aria-hidden="true" />
        <div :class="segmentedClass" role="group" aria-label="Filter by agent">
          <button
            type="button"
            :class="[
              optionClass,
              modelValue.agentType === null ? activeClass : inactiveOptionClass
            ]"
            :aria-pressed="modelValue.agentType === null"
            @click="update({ agentType: null })"
          >
            All agents
          </button>
          <button
            v-for="agentType in agentTypes"
            :key="agentType"
            type="button"
            :class="[optionClass, modelValue.agentType === agentType ? '' : inactiveOptionClass]"
            :style="modelValue.agentType === agentType ? agentSelectedStyle(agentType) : undefined"
            :aria-pressed="modelValue.agentType === agentType"
            @click="update({ agentType: modelValue.agentType === agentType ? null : agentType })"
          >
            {{ agentTypeLabel(agentType) }}
          </button>
        </div>
      </template>

      <template v-if="tags.length > 0">
        <span class="hidden sm:block w-px h-5 bg-border" aria-hidden="true" />
        <div ref="tagsRootRef" class="relative">
          <div class="flex items-center">
            <button
              type="button"
              :class="[
                triggerClass,
                modelValue.tag === null
                  ? [inactiveTriggerClass, 'rounded-md']
                  : [activeClass, 'rounded-l-md']
              ]"
              aria-haspopup="listbox"
              :aria-expanded="bTagsOpen"
              @click.stop="toggleTagsMenu"
            >
              <template v-if="modelValue.tag === null">Tags</template>
              <template v-else>
                Tag: <span class="font-medium">{{ modelValue.tag }}</span>
              </template>
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="shrink-0 opacity-60"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <button
              v-if="modelValue.tag !== null"
              type="button"
              :class="[triggerClass, [activeClass, 'rounded-r-md border-l-0 px-1.5!']]"
              aria-label="Clear tag filter"
              @click="update({ tag: null })"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                width="12"
                height="12"
                aria-hidden="true"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div
            v-if="bTagsOpen"
            class="absolute left-0 top-full mt-1 z-30 w-56 p-1.5 rounded-lg border border-border bg-surface shadow-xl"
            @click.stop
          >
            <input
              ref="tagSearchRef"
              v-model="tagQuery"
              type="text"
              class="input w-full h-8! text-xs! mb-1"
              placeholder="Search tags"
              aria-label="Search tags"
              @keydown.enter.prevent="onTagSearchEnter"
            />
            <div class="max-h-60 overflow-y-auto" role="listbox" aria-label="Filter by tag">
              <button
                v-for="tag in filteredTags"
                :key="tag"
                type="button"
                class="flex w-full items-center justify-between gap-2 px-2 py-1.5 rounded text-xs text-left text-text-primary hover:bg-fg/[0.07] transition-colors"
                role="option"
                :aria-selected="modelValue.tag === tag"
                @click="chooseTag(modelValue.tag === tag ? null : tag)"
              >
                <span class="min-w-0 truncate">{{ tag }}</span>
                <svg
                  v-if="modelValue.tag === tag"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="shrink-0 text-primary"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
              <div v-if="filteredTags.length === 0" class="px-2 py-1.5 text-xs text-text-muted">
                No matching tags
              </div>
            </div>
          </div>
        </div>
      </template>

      <button
        v-if="activeFilterCount > 0"
        type="button"
        class="text-xs text-text-muted hover:text-text-primary underline-offset-2 hover:underline"
        @click="clearFilters"
      >
        Clear
      </button>
    </div>
  </div>
</template>
