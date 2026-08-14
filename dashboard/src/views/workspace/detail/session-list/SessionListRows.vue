<script setup lang="ts">
// components
import SessionCard from '@/components/workspace/SessionCard.vue';
import OrchestratorCard from '@/components/workspace/OrchestratorCard.vue';

// types
import type { Orchestrator, Session } from '@/@types/index';
import type { CombinedItem } from './types';

// -------------------------------------------------- Props --------------------------------------------------
defineProps<{
  items: CombinedItem[];
  workspaceId: string;
  selectedIds: Set<string>;
  orchestratorSelectedIds: Set<string>;
  bSelectionActive: boolean;
}>();

// -------------------------------------------------- Emits --------------------------------------------------
const emit = defineEmits<{
  sessionContextMenu: [e: MouseEvent, session: Session];
  orchestratorContextMenu: [e: MouseEvent, orchestrator: Orchestrator];
  edit: [session: Session];
  archive: [session: Session];
  archiveOrchestrator: [orchestrator: Orchestrator];
  delete: [item: CombinedItem];
  toggleSelect: [id: string];
  toggleSelectOrchestrator: [id: string];
  sessionClick: [session: Session, e: Event];
  orchestratorClick: [orchestrator: Orchestrator, e: Event];
  sessionPointerDown: [e: PointerEvent, id: string];
  sessionPointerUp: [];
  sessionPointerMove: [e: PointerEvent];
  orchestratorPointerDown: [e: PointerEvent, id: string];
  orchestratorPointerUp: [];
  orchestratorPointerMove: [e: PointerEvent];
}>();
</script>

<template>
  <TransitionGroup name="list-stagger" tag="div" class="list-view-items">
    <div
      v-for="(item, index) in items"
      :key="item.kind === 'session' ? item.session.id : item.orchestrator.id"
      :style="{ '--stagger-index': index }"
      class="flex flex-col"
    >
      <SessionCard
        v-if="item.kind === 'session'"
        :session="item.session"
        :workspace-id="workspaceId"
        :b-selected="selectedIds.has(item.session.id)"
        :b-selection-active="bSelectionActive"
        @pointerdown="emit('sessionPointerDown', $event, item.session.id)"
        @pointerup="emit('sessionPointerUp')"
        @pointerleave="emit('sessionPointerUp')"
        @pointercancel="emit('sessionPointerUp')"
        @pointermove="emit('sessionPointerMove', $event)"
        @click="emit('sessionClick', item.session, $event)"
        @contextmenu.prevent.stop="emit('sessionContextMenu', $event, item.session)"
        @edit="emit('edit', item.session)"
        @archive="emit('archive', item.session)"
        @delete="emit('delete', item)"
        @toggle-select="emit('toggleSelect', item.session.id)"
      />

      <template v-else>
        <OrchestratorCard
          :orchestrator="item.orchestrator"
          :workspace-id="workspaceId"
          :b-selected="orchestratorSelectedIds.has(item.orchestrator.id)"
          :b-selection-active="bSelectionActive"
          @pointerdown="emit('orchestratorPointerDown', $event, item.orchestrator.id)"
          @pointerup="emit('orchestratorPointerUp')"
          @pointerleave="emit('orchestratorPointerUp')"
          @pointercancel="emit('orchestratorPointerUp')"
          @pointermove="emit('orchestratorPointerMove', $event)"
          @click="emit('orchestratorClick', item.orchestrator, $event)"
          @contextmenu.prevent.stop="emit('orchestratorContextMenu', $event, item.orchestrator)"
          @archive="emit('archiveOrchestrator', item.orchestrator)"
          @delete="emit('delete', item)"
          @toggle-select="emit('toggleSelectOrchestrator', item.orchestrator.id)"
        />

        <SessionCard
          v-for="child in item.nestedSessions"
          :key="child.id"
          :session="child"
          :workspace-id="workspaceId"
          b-nested
          @contextmenu.prevent.stop="emit('sessionContextMenu', $event, child)"
        />
      </template>
    </div>
  </TransitionGroup>
</template>
