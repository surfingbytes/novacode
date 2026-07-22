<script setup lang="ts">
// node_modules
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    /** id of the element labelling the dialog (usually the title) */
    labelledby?: string;
    /** extra classes for the panel sizing, e.g. 'max-w-sm' */
    panelClass?: string;
    closeOnBackdrop?: boolean;
    closeOnEsc?: boolean;
  }>(),
  {
    labelledby: undefined,
    panelClass: 'max-w-md',
    closeOnBackdrop: true,
    closeOnEsc: true
  }
);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  closed: [];
}>();

// -------------------------------------------------- Constants --------------------------------------------------

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Tracks the stack of open modals so only the topmost reacts to ESC/backdrop.
const openModalIds: number[] = [];
let nextModalId = 1;
let scrollLockCount = 0;
let previousBodyOverflow = '';

// -------------------------------------------------- Refs --------------------------------------------------

const modalId = nextModalId;
nextModalId += 1;

const panelRef = ref<HTMLElement | null>(null);
let previouslyFocused: Element | null = null;

// -------------------------------------------------- Methods --------------------------------------------------

const close = (): void => {
  emit('update:modelValue', false);
};

const bIsTopModal = (): boolean => {
  return openModalIds[openModalIds.length - 1] === modalId;
};

const onBackdropClick = (): void => {
  if (props.closeOnBackdrop && bIsTopModal()) {
    close();
  }
};

const onKeydown = (event: KeyboardEvent): void => {
  if (!bIsTopModal()) {
    return;
  }
  if (event.key === 'Escape' && props.closeOnEsc) {
    event.stopPropagation();
    close();
    return;
  }
  if (event.key === 'Tab') {
    trapFocus(event);
  }
};

const trapFocus = (event: KeyboardEvent): void => {
  const panel = panelRef.value;
  if (!panel) {
    return;
  }
  const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null
  );
  if (focusable.length === 0) {
    event.preventDefault();
    panel.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !panel.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
    event.preventDefault();
    first.focus();
  }
};

const lockScroll = (): void => {
  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
};

const unlockScroll = (): void => {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = previousBodyOverflow;
  }
};

const activate = (): void => {
  previouslyFocused = document.activeElement;
  openModalIds.push(modalId);
  lockScroll();
  document.addEventListener('keydown', onKeydown, true);
  // Focus the first sensible target inside the dialog.
  requestAnimationFrame(() => {
    const panel = panelRef.value;
    if (!panel) {
      return;
    }
    const autofocus = panel.querySelector<HTMLElement>('[data-modal-autofocus]');
    const firstFocusable = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    const target = autofocus ?? firstFocusable ?? panel;
    target.focus();
  });
};

const deactivate = (): void => {
  const index = openModalIds.indexOf(modalId);
  if (index !== -1) {
    openModalIds.splice(index, 1);
  }
  unlockScroll();
  document.removeEventListener('keydown', onKeydown, true);
  if (previouslyFocused instanceof HTMLElement) {
    previouslyFocused.focus();
  }
  previouslyFocused = null;
  emit('closed');
};

// -------------------------------------------------- Watchers --------------------------------------------------

watch(
  () => props.modelValue,
  (bOpen) => {
    if (bOpen) {
      activate();
    } else {
      deactivate();
    }
  }
);

// -------------------------------------------------- Lifecycle --------------------------------------------------

onMounted((): void => {
  if (props.modelValue) {
    activate();
  }
});

onBeforeUnmount((): void => {
  if (props.modelValue) {
    deactivate();
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="labelledby"
      >
        <div class="absolute inset-0 bg-black/75 backdrop-blur-sm" @click="onBackdropClick"></div>
        <div
          ref="panelRef"
          class="modal-panel relative flex max-h-[calc(100%-2rem)] w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/60 outline-none"
          :class="panelClass"
          tabindex="-1"
        >
          <slot :close="close" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
