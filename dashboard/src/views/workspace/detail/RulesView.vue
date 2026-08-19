<script setup lang="ts">
// node_modules
import { computed, onMounted, ref } from 'vue';

// components
import RuleFilesEditor from '@/components/RuleFilesEditor.vue';

// classes
import { globalRulesApi } from '@/classes/api';

// types
import type { Workspace } from '@/@types/index';

defineProps<{
  workspace: Workspace;
}>();

const globalRulesCount = ref(0);

const globalRulesNote = computed(() => {
  const n = globalRulesCount.value;
  if (n <= 0) {
    return null;
  }
  return n === 1
    ? '1 global rule also applies to this workspace.'
    : `${n} global rules also apply to this workspace.`;
});

onMounted(async () => {
  try {
    const { data } = await globalRulesApi.list();
    globalRulesCount.value = Array.isArray(data) ? data.length : 0;
  } catch {
    globalRulesCount.value = 0;
  }
});
</script>

<template>
  <div>
    <p
      v-if="globalRulesNote"
      class="mb-4 px-4 py-3 rounded-lg border border-fg/10 bg-fg/[0.02] text-sm text-text-muted"
    >
      {{ globalRulesNote }}
      <RouterLink
        :to="{ name: 'settings', query: { tab: 'rules' } }"
        class="font-semibold text-primary hover:underline ml-1"
      >
        Manage in Settings → Rules
      </RouterLink>
    </p>
    <RuleFilesEditor source="workspace" :workspace-id="workspace.id" />
  </div>
</template>
