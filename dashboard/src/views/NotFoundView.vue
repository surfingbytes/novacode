<script setup lang="ts">
import PageShell from '@/components/layout/PageShell.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
</script>

<template>
  <PageShell>
    <EmptyState icon="search" title="Page not found" description="That URL does not match a workspace, session, or settings page.">
      <RouterLink :to="{ name: 'workspaces' }" class="button is-primary">
        Back to workspaces
      </RouterLink>
    </EmptyState>
  </PageShell>
</template>
