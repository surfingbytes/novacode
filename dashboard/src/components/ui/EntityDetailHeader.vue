<script setup lang="ts">
// node_modules
import { ref, computed, onMounted, onUnmounted, inject } from 'vue';

// classes
import { tagColorClass } from '@/utils/tagColors';

// types
import { APP_NAV_TOGGLE_KEY } from '@/constants/layout';

// -------------------------------------------------- Props --------------------------------------------------
const props = withDefaults(
  defineProps<{
    title: string;
    /** Workspace name shown under the title */
    subtitle?: string;
    tags?: string[];
    bLoading?: boolean;
    archived?: boolean;
    bShowSidebarToggle?: boolean;
    /** Show the lg:hidden app-nav button (uses the injected app-nav toggle) */
    showAppMenu?: boolean;
    /** Lowercase noun used in action tooltips, e.g. 'session' / 'orchestrator' */
    entityLabel?: string;
  }>(),
  {
    subtitle: undefined,
    tags: () => [],
    bLoading: false,
    archived: false,
    bShowSidebarToggle: false,
    showAppMenu: true,
    entityLabel: 'session'
  }
);

// -------------------------------------------------- Emits --------------------------------------------------
const emit = defineEmits<{
  (e: 'toggleSidebar'): void;
  (e: 'edit'): void;
  (e: 'archive'): void;
  (e: 'delete'): void;
}>();

// -------------------------------------------------- Store --------------------------------------------------
const toggleAppNav = inject(APP_NAV_TOGGLE_KEY, null);

// -------------------------------------------------- Refs --------------------------------------------------
const bMobileMenuOpen = ref(false);
const mobileMenuRef = ref<HTMLElement | null>(null);

// -------------------------------------------------- Computed --------------------------------------------------
const entityLabelTitle = computed(
  () => props.entityLabel.charAt(0).toUpperCase() + props.entityLabel.slice(1)
);

// -------------------------------------------------- Methods --------------------------------------------------
function closeMobileMenu(): void {
  bMobileMenuOpen.value = false;
}

function handleDocumentClick(e: MouseEvent): void {
  const el = mobileMenuRef.value;
  if (bMobileMenuOpen.value && el && !el.contains(e.target as Node)) {
    closeMobileMenu();
  }
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && bMobileMenuOpen.value) {
    closeMobileMenu();
  }
}

function onMobileMenuEdit(): void {
  closeMobileMenu();
  emit('edit');
}

function onMobileMenuArchive(): void {
  closeMobileMenu();
  emit('archive');
}

function onMobileMenuDelete(): void {
  closeMobileMenu();
  emit('delete');
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
  <div class="h-16 px-4 md:px-6 flex items-center border-b border-fg/10 shrink-0 gap-3 min-w-0">
    <!-- Name + tags -->
    <div class="flex-1 min-w-0 flex flex-col gap-0.5">
      <div class="flex items-center min-w-0">
        <button
          v-if="showAppMenu && toggleAppNav"
          type="button"
          class="button is-transparent is-icon mr-1 lg:hidden! shrink-0"
          title="App menu"
          aria-label="App menu"
          @click="toggleAppNav()"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18 M3 12h18 M3 18h18" /></svg>
        </button>
        <button
          v-if="bShowSidebarToggle"
          type="button"
          class="button is-transparent is-icon mr-2 lg:hidden! shrink-0"
          title="Sessions list"
          aria-label="Sessions list"
          @click="emit('toggleSidebar')"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>
        </button>
        <div class="flex flex-col min-w-0">
          <h1 class="text-base font-semibold text-text-primary truncate">
            {{ bLoading ? '…' : title }}
          </h1>
          <!-- workspace name -->
          <p v-if="subtitle" class="text-xs text-text-muted">
            {{ subtitle }}
          </p>
          <span
            v-if="tags.length"
            class="inline-flex flex-wrap items-center gap-1 mt-0.5"
          >
            <span
              v-for="tag in tags"
              :key="tag"
              class="inline-flex items-center text-xs px-2 py-0.5 rounded-full border"
              :class="tagColorClass(tag)"
            >
              {{ tag }}
            </span>
          </span>
        </div>
      </div>
    </div>

    <!-- Archive + Edit + Delete -->
    <div v-if="!bLoading" class="hidden lg:flex items-center gap-1 shrink-0">
      <button
        type="button"
        class="button is-transparent is-icon"
        :title="`Edit ${entityLabel}`"
        :aria-label="`Edit ${entityLabel}`"
        @click="emit('edit')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg>
      </button>
      <button
        type="button"
        class="button is-transparent is-icon"
        :title="archived ? `Unarchive ${entityLabel}` : `Archive ${entityLabel}`"
        :aria-label="archived ? `Unarchive ${entityLabel}` : `Archive ${entityLabel}`"
        @click="emit('archive')"
      >
        <svg v-if="archived" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-primary" aria-hidden="true"><path d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M12 12v4M10 14l2-2 2 2"/></svg>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-warning" aria-hidden="true"><path d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4"/></svg>
      </button>

      <button
        type="button"
        class="button is-transparent is-icon hover:!text-destructive hover:!bg-destructive/10"
        :title="`Delete ${entityLabel}`"
        :aria-label="`Delete ${entityLabel}`"
        @click="emit('delete')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-destructive" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
      </button>
    </div>

    <!-- Mobile: overflow menu (Edit / Archive / Delete) -->
    <div v-if="!bLoading" ref="mobileMenuRef" class="relative lg:hidden shrink-0">
      <button
        type="button"
        class="button is-transparent is-icon"
        aria-haspopup="true"
        :aria-expanded="bMobileMenuOpen"
        :title="`${entityLabelTitle} actions`"
        :aria-label="`${entityLabelTitle} actions`"
        @click.stop="bMobileMenuOpen = !bMobileMenuOpen"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="0" aria-hidden="true"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>
      </button>
      <Transition name="mobile-session-menu-drop">
        <div
          v-if="bMobileMenuOpen"
          class="absolute right-0 top-full mt-1 z-50 min-w-[11rem] rounded-lg border border-border bg-surface py-1 shadow-lg"
          role="menu"
          @click.stop
        >
          <button
            type="button"
            class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-text-primary hover:bg-fg/[0.06] transition-colors"
            role="menuitem"
            @click="onMobileMenuEdit"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="shrink-0" aria-hidden="true"><path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg>
            Edit
          </button>
          <button
            type="button"
            class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-text-primary hover:bg-fg/[0.06] transition-colors"
            role="menuitem"
            @click="onMobileMenuArchive"
          >
            <svg v-if="archived" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-primary" aria-hidden="true"><path d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M12 12v4M10 14l2-2 2 2"/></svg>
            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-warning" aria-hidden="true"><path d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4"/></svg>
            {{ archived ? 'Unarchive' : 'Archive' }}
          </button>
          <button
            type="button"
            class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-destructive hover:bg-destructive/[0.08] transition-colors"
            role="menuitem"
            @click="onMobileMenuDelete"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="shrink-0" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
            Delete
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.mobile-session-menu-drop-enter-active,
.mobile-session-menu-drop-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
  transform-origin: top right;
}

.mobile-session-menu-drop-enter-from,
.mobile-session-menu-drop-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

.mobile-session-menu-drop-enter-to,
.mobile-session-menu-drop-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
}
</style>
