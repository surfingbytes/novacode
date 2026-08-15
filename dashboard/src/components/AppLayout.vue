<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, provide } from 'vue';
import { useRoute } from 'vue-router';
import NavSidebar from '@/components/NavSidebar.vue';
import NavTopBar from '@/components/NavTopBar.vue';
import GlobalSearchModal from '@/components/GlobalSearchModal.vue';
import {
  APP_NAV_TOGGLE_KEY,
  FULL_HEIGHT_ROUTE_NAMES,
  PANE_LAYOUT_MIN_WIDTH
} from '@/constants/layout';
import { safeGetItem, safeSetItem } from '@/lib/safeLocalStorage';

const SIDEBAR_COLLAPSED_KEY = 'sidebarCollapsed';

const route = useRoute();
const bSidebarIsOpen = ref(false);
const bSidebarCollapsed = ref(safeGetItem(SIDEBAR_COLLAPSED_KEY) === 'true');
const bSearchModalOpen = ref(false);
const isFullHeightRoute = computed(() => FULL_HEIGHT_ROUTE_NAMES.has(route.name as string));
const hideMobileTopBar = computed(() => isFullHeightRoute.value);

watch(bSidebarCollapsed, (val) => {
  safeSetItem(SIDEBAR_COLLAPSED_KEY, val ? 'true' : 'false');
});

watch(
  () => route.path,
  () => { bSidebarIsOpen.value = false; }
);

function toggleSidebar(): void {
  bSidebarIsOpen.value = !bSidebarIsOpen.value;
}

provide(APP_NAV_TOGGLE_KEY, toggleSidebar);

function closeSidebar(): void {
  bSidebarIsOpen.value = false;
}

function toggleCollapsed(): void {
  // Fold / tablet / desktop: toggle icon rail ↔ expanded
  // Phone: toggle drawer open/close
  if (window.innerWidth >= PANE_LAYOUT_MIN_WIDTH) {
    bSidebarCollapsed.value = !bSidebarCollapsed.value;
  } else {
    toggleSidebar();
  }
}

function openSearchModal(): void {
  bSearchModalOpen.value = true;
}

function closeSearchModal(): void {
  bSearchModalOpen.value = false;
}

function handleSearchNavigate(): void {
  closeSearchModal();
  closeSidebar();
}

function handleMobileSearch(): void {
  closeSidebar();
  setTimeout(() => { openSearchModal(); }, 100);
}

function handleKeyDown(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key === 'k') {
    event.preventDefault();
    openSearchModal();
    return;
  }
  if (bSearchModalOpen.value) {
    return;
  }
  if (key === 'n') {
    event.preventDefault();
    window.dispatchEvent(new CustomEvent('novacode:new-session'));
  }
}

onMounted(() => { window.addEventListener('keydown', handleKeyDown); });
onBeforeUnmount(() => { window.removeEventListener('keydown', handleKeyDown); });
</script>

<template>
  <div class="flex h-full bg-bg">
    <!-- Sidebar -->
    <NavSidebar
      :is-open="bSidebarIsOpen"
      :collapsed="bSidebarCollapsed"
      @close="closeSidebar"
      @search="handleMobileSearch"
      @toggle-collapsed="toggleCollapsed"
    />

    <!-- Main content -->
    <div class="flex flex-1 flex-col min-w-0 h-full">
      <NavTopBar
        :hide-on-mobile="hideMobileTopBar"
        :sidebar-open="bSidebarIsOpen"
        :on-menu-click="toggleSidebar"
        :on-search-click="openSearchModal"
      />

      <main
        class="flex flex-1 flex-col min-h-0"
        :class="isFullHeightRoute ? 'overflow-hidden' : 'overflow-y-auto'"
      >
        <RouterView v-slot="{ Component }">
          <component :is="Component" />
        </RouterView>
      </main>

      <GlobalSearchModal
        :is-open="bSearchModalOpen"
        :on-close="closeSearchModal"
        @navigate="handleSearchNavigate"
      />
    </div>
  </div>
</template>
