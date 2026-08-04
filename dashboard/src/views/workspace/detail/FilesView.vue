<script setup lang="ts">
// components
import FilesView from '@/components/workspace/FilesComponent.vue';

// stores
import type { Workspace } from '@/@types';

// -------------------------------------------------- Props --------------------------------------------------
defineProps<{
  workspace: Workspace;
}>();
</script>

<template>
  <div class="h-full min-h-0 flex flex-col">
    <FilesView class="flex-1 min-h-0" :workspace-id="workspace.id" :active="true" />
  </div>
</template>
