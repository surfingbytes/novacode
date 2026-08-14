<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import FilesView from '@/components/workspace/FilesComponent.vue';

import type { Workspace } from '@/@types';

defineProps<{
  workspace: Workspace;
}>();

const route = useRoute();
const router = useRouter();

const openPath = computed((): string | null => {
  const file = route.query.file;
  return typeof file === 'string' && file.trim() ? file : null;
});

function onOpenPath(path: string | null): void {
  const nextQuery = { ...route.query };
  if (path) {
    nextQuery.file = path;
  } else {
    delete nextQuery.file;
  }
  void router.replace({ query: nextQuery });
}
</script>

<template>
  <div class="h-full min-h-0 flex flex-col">
    <FilesView
      class="flex-1 min-h-0"
      :workspace-id="workspace.id"
      :active="true"
      :open-path="openPath"
      @update:open-path="onOpenPath"
    />
  </div>
</template>
