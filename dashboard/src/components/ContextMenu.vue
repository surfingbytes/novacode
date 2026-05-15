<script lang="ts">
export type ContextMenuItem = {
  key: string;
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
};
</script>

<script setup lang="ts">
// node_modules
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  x: number;
  y: number;
  items: ContextMenuItem[];
}>();

const bOpen = defineModel<boolean>({ default: false });

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  pick: [key: string];
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const pos = ref({ x: 0, y: 0 });
const menuRef = ref<HTMLElement | null>(null);

let bGlobalListenersBound = false;
let pointerRaf: number | null = null;

// -------------------------------------------------- Methods --------------------------------------------------

function clampMenu(): void {
  const el = menuRef.value;
  if (!el) {
    return;
  }
  const pad = 8;
  const rect = el.getBoundingClientRect();
  let nx = pos.value.x;
  let ny = pos.value.y;
  if (nx + rect.width > window.innerWidth - pad) {
    nx = Math.max(pad, window.innerWidth - rect.width - pad);
  }
  if (ny + rect.height > window.innerHeight - pad) {
    ny = Math.max(pad, window.innerHeight - rect.height - pad);
  }
  if (nx < pad) {
    nx = pad;
  }
  if (ny < pad) {
    ny = pad;
  }
  pos.value = { x: nx, y: ny };
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    bOpen.value = false;
  }
}

function onPointerDown(e: PointerEvent): void {
  if (menuRef.value?.contains(e.target as Node)) {
    return;
  }
  bOpen.value = false;
}

function onScroll(): void {
  bOpen.value = false;
}

function bindGlobal(): void {
  if (bGlobalListenersBound) {
    return;
  }
  bGlobalListenersBound = true;
  document.addEventListener('keydown', onKey);
  window.addEventListener('scroll', onScroll, true);
  pointerRaf = requestAnimationFrame(() => {
    pointerRaf = null;
    document.addEventListener('pointerdown', onPointerDown, true);
  });
}

function unbindGlobal(): void {
  if (pointerRaf !== null) {
    cancelAnimationFrame(pointerRaf);
    pointerRaf = null;
  }
  if (!bGlobalListenersBound) {
    return;
  }
  bGlobalListenersBound = false;
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('pointerdown', onPointerDown, true);
  window.removeEventListener('scroll', onScroll, true);
}

// -------------------------------------------------- Watchers --------------------------------------------------

watch(
  () => bOpen.value,
  (isOpen) => {
    if (isOpen) {
      pos.value = { x: props.x, y: props.y };
      nextTick(() => clampMenu());
      bindGlobal();
    } else {
      unbindGlobal();
    }
  }
);

watch(
  () => [props.x, props.y] as const,
  () => {
    if (!bOpen.value) {
      return;
    }
    pos.value = { x: props.x, y: props.y };
    nextTick(() => clampMenu());
  }
);

// -------------------------------------------------- Lifecycle --------------------------------------------------

onBeforeUnmount(() => {
  unbindGlobal();
});

function onPick(item: ContextMenuItem): void {
  if (item.disabled) {
    return;
  }
  emit('pick', item.key);
  bOpen.value = false;
}

function getContextIconSvg(icon: string): string {
  const paths: Record<string, string> = {
    open_in_new: '<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    edit: '<path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/>',
    inventory_2: '<path d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4"/>',
    unarchive: '<path d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M12 12v4M10 14l2-2 2 2"/>',
    delete: '<path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>',
  };
  const d = paths[icon] ?? '<circle cx="12" cy="12" r="2"/>';
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
</script>

<template>
  <Teleport to="body">
    <ul
      v-show="bOpen"
      ref="menuRef"
      role="menu"
      class="fixed z-[300] py-1 min-w-[11rem] max-h-[min(70vh,24rem)] overflow-y-auto rounded-lg border border-border bg-bg shadow-xl text-sm"
      :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
      @click.stop
    >
      <li v-for="it in items" :key="it.key" role="none">
        <button
          type="button"
          role="menuitem"
          class="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-fg/[0.06] disabled:opacity-40 disabled:pointer-events-none"
          :class="it.danger ? 'text-destructive hover:bg-destructive/10' : 'text-text-primary'"
          :disabled="it.disabled"
          @click="onPick(it)"
        >
          <span v-if="it.icon" class="shrink-0 opacity-80" v-html="getContextIconSvg(it.icon)" />
          {{ it.label }}
        </button>
      </li>
    </ul>
  </Teleport>
</template>
