<script setup lang="ts">
// components
import SessionCard from '@/components/workspace/SessionCard.vue';
import OrchestratorCard from '@/components/workspace/OrchestratorCard.vue';
import VirtualGrid from '@/components/ui/VirtualGrid.vue';

// types
import type { Orchestrator, Session } from '@/@types/index';
import type { CombinedItem } from './types';

// -------------------------------------------------- Props --------------------------------------------------
defineProps<{
  items: CombinedItem[];
  workspaceId: string;
}>();

// -------------------------------------------------- Emits --------------------------------------------------
const emit = defineEmits<{
  sessionContextMenu: [e: MouseEvent, session: Session];
  orchestratorContextMenu: [e: MouseEvent, orchestrator: Orchestrator];
  edit: [session: Session];
  archive: [session: Session];
  archiveOrchestrator: [orchestrator: Orchestrator];
  delete: [item: CombinedItem];
}>();

// -------------------------------------------------- Methods --------------------------------------------------
function combinedItemKey(item: CombinedItem): string {
  return item.kind === 'session' ? item.session.id : item.orchestrator.id;
}
</script>

<template>
  <div class="grid-view">
    <VirtualGrid
      :items="items"
      :item-key="combinedItemKey"
      :estimate-row-size="112"
      grid-class="grid-view-items"
    >
      <template #default="{ item, index }">
        <SessionCard
          v-if="item.kind === 'session'"
          :session="item.session"
          :workspace-id="workspaceId"
          b-grid
          :style="{ '--stagger-index': index }"
          @contextmenu.prevent.stop="emit('sessionContextMenu', $event, item.session)"
          @edit="emit('edit', item.session)"
          @archive="emit('archive', item.session)"
          @delete="emit('delete', item)"
        />
        <OrchestratorCard
          v-else
          :orchestrator="item.orchestrator"
          :workspace-id="workspaceId"
          b-grid
          :style="{ '--stagger-index': index }"
          @contextmenu.prevent.stop="emit('orchestratorContextMenu', $event, item.orchestrator)"
          @archive="emit('archiveOrchestrator', item.orchestrator)"
          @delete="emit('delete', item)"
        />
      </template>
    </VirtualGrid>
  </div>
</template>
