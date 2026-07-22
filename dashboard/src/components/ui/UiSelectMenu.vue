<script setup lang="ts">
/**
 * App-style dropdown select — replaces cramped native <select> elements.
 * Button shows the current value; opens a floating option panel (upward by
 * default, e.g. in the composer) with keyboard navigation, ESC and
 * click-outside handling.
 */

// node_modules
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

// -------------------------------------------------- Types --------------------------------------------------

export interface SelectMenuOption {
  value: string;
  label: string;
  hint?: string;
}

// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: SelectMenuOption[];
    disabled?: boolean;
    ariaLabel?: string;
    /** Extra classes for the trigger button (e.g. width) */
    buttonClass?: string;
    /** Open the panel above the trigger (composer bottom bar) */
    bOpenUp?: boolean;
  }>(),
  {
    disabled: false,
    ariaLabel: undefined,
    buttonClass: '',
    bOpenUp: true
  }
);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  'update:modelValue': [value: string];
  /** A special option marked with data-special was chosen (not emitted as value) */
  special: [value: string];
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const rootRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const bOpen = ref(false);
const activeIndex = ref(-1);

// -------------------------------------------------- Computed --------------------------------------------------

const selectedLabel = computed(() => {
  const found = props.options.find((option) => option.value === props.modelValue);
  return found?.label ?? props.modelValue;
});

// -------------------------------------------------- Methods --------------------------------------------------

function openMenu(): void {
  if (props.disabled) return;
  bOpen.value = true;
  activeIndex.value = props.options.findIndex((option) => option.value === props.modelValue);
  void nextTick(() => {
    const active = panelRef.value?.querySelector('[data-active="true"]');
    active?.scrollIntoView?.({ block: 'nearest' });
  });
}

function closeMenu(): void {
  bOpen.value = false;
  activeIndex.value = -1;
}

function toggleMenu(): void {
  if (bOpen.value) {
    closeMenu();
  } else {
    openMenu();
  }
}

function choose(option: SelectMenuOption): void {
  if (option.hint === 'special') {
    emit('special', option.value);
    // keep open — caller decides (e.g. "More…" expands the list)
    void nextTick(() => {
      activeIndex.value = props.options.findIndex((o) => o.value === props.modelValue);
    });
    return;
  }
  if (option.value !== props.modelValue) {
    emit('update:modelValue', option.value);
  }
  closeMenu();
}

function scrollActiveIntoView(): void {
  void nextTick(() => {
    const active = panelRef.value?.querySelector('[data-active="true"]');
    active?.scrollIntoView?.({ block: 'nearest' });
  });
}

function onTriggerKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!bOpen.value) {
      openMenu();
    }
    // When already open the event bubbles to the root keydown handler,
    // which moves the active option / selects it.
  }
}

function onPanelKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (props.options.length === 0) return;
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    activeIndex.value = (activeIndex.value + delta + props.options.length) % props.options.length;
    scrollActiveIntoView();
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    const option = props.options[activeIndex.value];
    if (option) choose(option);
  }
}

function handleDocumentClick(event: MouseEvent): void {
  const el = rootRef.value;
  if (bOpen.value && el && !el.contains(event.target as Node)) {
    closeMenu();
  }
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && bOpen.value) {
    event.stopPropagation();
    closeMenu();
  }
}

// -------------------------------------------------- Watchers --------------------------------------------------

watch(
  () => props.options,
  () => {
    if (bOpen.value) {
      activeIndex.value = props.options.findIndex((option) => option.value === props.modelValue);
    }
  }
);

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
  <div ref="rootRef" class="relative min-w-0 shrink-0" @keydown="onPanelKeydown">
    <button
      type="button"
      class="select-menu-trigger"
      :class="buttonClass"
      :disabled="disabled"
      :aria-label="ariaLabel"
      aria-haspopup="listbox"
      :aria-expanded="bOpen"
      @click.stop="toggleMenu"
      @keydown="onTriggerKeydown"
    >
      <span class="min-w-0 truncate">{{ selectedLabel }}</span>
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

    <Transition name="select-menu-drop">
      <div
        v-if="bOpen"
        ref="panelRef"
        class="select-menu-panel"
        :class="bOpenUp ? 'bottom-full mb-1' : 'top-full mt-1'"
        role="listbox"
        :aria-label="ariaLabel"
        @click.stop
      >
        <button
          v-for="(option, index) in options"
          :key="option.value"
          type="button"
          class="select-menu-option"
          :class="{ 'is-current': option.value === modelValue }"
          :data-active="index === activeIndex || undefined"
          role="option"
          :aria-selected="option.value === modelValue"
          @click="choose(option)"
          @mouseenter="activeIndex = index"
        >
          <span class="min-w-0 truncate">{{ option.label }}</span>
          <svg
            v-if="option.value === modelValue"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="shrink-0 text-[var(--accent)]"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
        <div v-if="options.length === 0" class="px-3 py-2 text-xs text-[var(--fg-subtle)]">
          No options
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.select-menu-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  height: 22px;
  padding: 0 7px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--bg-elev);
  color: var(--fg);
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 0.1s,
    border-color 0.1s;
  min-width: 0;
}
.select-menu-trigger:hover {
  background: var(--bg-hover);
  border-color: var(--line-strong);
}
.select-menu-trigger:focus-visible {
  outline: none;
  border-color: var(--accent-line);
}
.select-menu-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.select-menu-panel {
  position: absolute;
  left: 0;
  z-index: 60;
  min-width: 100%;
  width: max-content;
  max-width: 260px;
  max-height: 256px;
  overflow-y: auto;
  padding: 3px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg-elev-2);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}

.select-menu-option {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--fg);
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
  transition: background 0.08s;
}
.select-menu-option:hover,
.select-menu-option[data-active='true'] {
  background: var(--bg-hover);
}
.select-menu-option.is-current {
  color: var(--fg);
  font-weight: 500;
}

.select-menu-drop-enter-active,
.select-menu-drop-leave-active {
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
}
.select-menu-drop-enter-from,
.select-menu-drop-leave-to {
  opacity: 0;
  transform: translateY(3px);
}
</style>
