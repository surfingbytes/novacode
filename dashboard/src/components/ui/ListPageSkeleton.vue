<script setup lang="ts">
/**
 * Pulse placeholders for list pages. Matches session/automation list rows,
 * grid cards, and the workspace card grid.
 */

withDefaults(
  defineProps<{
    variant?: 'rows' | 'cards' | 'workspaces' | 'lines';
    count?: number;
    label?: string;
  }>(),
  {
    variant: 'rows',
    count: 6,
    label: 'Loading'
  }
);
</script>

<template>
  <div role="status" aria-live="polite" aria-busy="true">
    <span class="sr-only">{{ label }}</span>

    <div v-if="variant === 'rows'" class="list-view">
      <div class="list-view-items">
        <div v-for="i in count" :key="i" class="list-item pointer-events-none">
          <div class="h-3 w-2/5 max-w-xs rounded bg-fg/10 animate-pulse motion-reduce:animate-none" />
          <div class="h-3 w-16 rounded-full bg-fg/10 animate-pulse motion-reduce:animate-none" />
          <div class="ml-auto h-3 w-20 rounded bg-fg/10 animate-pulse motion-reduce:animate-none" />
        </div>
      </div>
    </div>

    <div v-else-if="variant === 'cards'" class="grid-view">
      <div class="grid-view-items">
        <div
          v-for="i in count"
          :key="i"
          class="grid-item pointer-events-none hover:bg-card/30! hover:border-border!"
        >
          <div class="top">
            <div class="icon bg-fg/10 animate-pulse motion-reduce:animate-none" />
            <div class="info gap-2!">
              <div class="h-3 w-2/3 rounded bg-fg/10 animate-pulse motion-reduce:animate-none" />
              <div class="h-3 w-24 rounded-full bg-fg/10 animate-pulse motion-reduce:animate-none" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-else-if="variant === 'workspaces'"
      class="grid gap-2.5"
      style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))"
    >
      <div
        v-for="i in count"
        :key="i"
        class="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg-elev)]"
      >
        <div class="h-[3px] bg-fg/10" />
        <div class="flex items-center gap-2.5 px-3 pt-3 pb-2.5">
          <div
            class="h-8 w-8 shrink-0 rounded-lg bg-fg/10 animate-pulse motion-reduce:animate-none"
          />
          <div class="min-w-0 flex-1 space-y-1.5">
            <div class="h-3 w-2/3 rounded bg-fg/10 animate-pulse motion-reduce:animate-none" />
            <div class="h-2.5 w-1/2 rounded bg-fg/10 animate-pulse motion-reduce:animate-none" />
          </div>
        </div>
        <div class="px-3 pb-3">
          <div class="h-2.5 w-1/3 rounded bg-fg/10 animate-pulse motion-reduce:animate-none" />
        </div>
      </div>
    </div>

    <div v-else class="space-y-2.5">
      <div
        v-for="i in count"
        :key="i"
        class="h-8 rounded bg-fg/10 animate-pulse motion-reduce:animate-none"
      />
    </div>
  </div>
</template>
