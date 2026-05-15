<script setup lang="ts">
// node_modules
import { ref } from 'vue';
import { useRouter } from 'vue-router';

// stores
import { useAuthStore } from '@/stores/auth';

// -------------------------------------------------- Refs --------------------------------------------------
const auth = useAuthStore();
const router = useRouter();
const bMenuOpen = ref<boolean>(false);
const bUserMenuOpen = ref<boolean>(false);

// -------------------------------------------------- Computed --------------------------------------------------
// (none)

// -------------------------------------------------- Methods --------------------------------------------------
const handleLogout = (): void => {
  auth.logout();
  router.push('/login');
  bUserMenuOpen.value = false;
  bMenuOpen.value = false;
};
</script>

<template>
  <nav class="sticky top-0 z-50 bg-bg/80 backdrop-blur-xl border-b border-fg/[0.06]">
    <div class="flex h-16 items-center justify-between px-4 md:px-6">
      <!-- Brand + nav links -->
      <div class="flex items-center gap-5">
        <RouterLink
          to="/"
          class="flex items-center gap-2 font-semibold text-text-primary hover:text-text-primary/80 transition-colors"
        >
          <img src="/icon.png" alt="Nova Code" class="w-6 h-6" />
          <span class="text-sm tracking-tight">Nova Code</span>
        </RouterLink>

        <div class="hidden md:flex items-center gap-0.5">
          <RouterLink
            to="/workspaces"
            class="main-nav-link px-3 py-2 text-sm text-text-muted hover:text-text-primary hover:bg-fg/[0.06] rounded-md border-b-2 border-transparent transition-all duration-200"
            @click="bMenuOpen = false"
          >
            Workspaces
          </RouterLink>
          <RouterLink
            to="/automations"
            class="main-nav-link px-3 py-2 text-sm text-text-muted hover:text-text-primary hover:bg-fg/[0.06] rounded-md border-b-2 border-transparent transition-all duration-200"
            @click="bMenuOpen = false"
          >
            Automations
          </RouterLink>
          <RouterLink
            to="/role-templates"
            class="main-nav-link px-3 py-2 text-sm text-text-muted hover:text-text-primary hover:bg-fg/[0.06] rounded-md border-b-2 border-transparent transition-all duration-200"
            @click="bMenuOpen = false"
          >
            Rule templates
          </RouterLink>
          <RouterLink
            to="/settings"
            class="main-nav-link px-3 py-2 text-sm text-text-muted hover:text-text-primary hover:bg-fg/[0.06] rounded-md border-b-2 border-transparent transition-all duration-200"
            @click="bMenuOpen = false"
          >
            Settings
          </RouterLink>
        </div>
      </div>

      <!-- Username + user menu (logout) + settings -->
      <div class="flex items-center gap-2">
        <span class="hidden md:block text-sm text-text-muted">{{ auth.username }}</span>
        <!-- User menu (logout) - desktop: dropdown on the other side of username -->
        <div class="hidden md:block relative">
          <button
            class="p-2 text-text-muted hover:text-text-primary hover:bg-fg/[0.06] rounded-lg transition-colors"
            aria-label="User menu"
            aria-haspopup="true"
            :aria-expanded="bUserMenuOpen"
            @click="bUserMenuOpen = !bUserMenuOpen"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </button>
          <Transition name="nav-drop">
            <div
              v-if="bUserMenuOpen"
              class="absolute right-0 top-full mt-1 py-1 min-w-[140px] bg-surface border border-fg/[0.08] rounded-lg shadow-lg z-50"
              role="menu"
            >
              <RouterLink
                to="/account"
                role="menuitem"
                class="block w-full text-left px-4 py-2.5 text-sm text-text-primary hover:bg-fg/[0.06] rounded-t-lg transition-colors"
                @click="bUserMenuOpen = false"
              >
                Account
              </RouterLink>
              <button
                role="menuitem"
                class="w-full text-left px-4 py-2.5 text-sm text-destructive hover:bg-destructive/[0.08] rounded-b-lg transition-colors"
                @click="handleLogout"
              >
                Logout
              </button>
            </div>
          </Transition>
        </div>
        <RouterLink
          to="/settings"
          class="p-2 text-text-muted hover:text-text-primary hover:bg-fg/[0.06] rounded-lg transition-colors"
          aria-label="Settings"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
        </RouterLink>
        <!-- Mobile burger -->
        <button
          class="md:hidden p-2 text-text-muted hover:text-text-primary transition-colors"
          aria-label="Toggle menu"
          @click="bMenuOpen = !bMenuOpen"
        >
          <svg v-if="bMenuOpen" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M18 6L6 18M6 6l12 12"/></svg>
          <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
      </div>
    </div>

    <!-- Mobile dropdown -->
    <Transition name="nav-drop">
      <div
        v-if="bMenuOpen"
        class="md:hidden border-t border-fg/[0.06] bg-bg px-4 py-2 flex flex-col gap-1"
      >
        <RouterLink
          to="/workspaces"
          class="px-3 py-3 text-sm text-text-primary hover:text-text-primary hover:bg-fg/[0.06] rounded-md block transition-colors"
          @click="bMenuOpen = false"
        >
          Workspaces
        </RouterLink>
        <RouterLink
          to="/automations"
          class="px-3 py-3 text-sm text-text-primary hover:text-text-primary hover:bg-fg/[0.06] rounded-md block transition-colors"
          @click="bMenuOpen = false"
        >
          Automations
        </RouterLink>
        <RouterLink
          to="/role-templates"
          class="px-3 py-3 text-sm text-text-primary hover:text-text-primary hover:bg-fg/[0.06] rounded-md block transition-colors"
          @click="bMenuOpen = false"
        >
          Rule templates
        </RouterLink>
        <RouterLink
          to="/account"
          class="px-3 py-3 text-sm text-text-primary hover:text-text-primary hover:bg-fg/[0.06] rounded-md block transition-colors"
          @click="bMenuOpen = false"
        >
          Account
        </RouterLink>
        <RouterLink
          to="/settings"
          class="px-3 py-3 text-sm text-text-primary hover:text-text-primary hover:bg-fg/[0.06] rounded-md block transition-colors"
          @click="bMenuOpen = false"
        >
          Settings
        </RouterLink>
        <div class="flex items-center justify-between px-3 py-3 mt-1 border-t border-fg/[0.06]">
          <span class="text-sm text-text-muted">{{ auth.username }}</span>
          <button
            class="text-sm text-destructive hover:bg-destructive/[0.08] px-3 py-2 rounded-md transition-colors"
            @click="handleLogout"
          >
            Logout
          </button>
        </div>
      </div>
    </Transition>
  </nav>
</template>
