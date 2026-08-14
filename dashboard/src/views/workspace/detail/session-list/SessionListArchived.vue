<script setup lang="ts">
// components
import SessionCard from '@/components/workspace/SessionCard.vue';
import OrchestratorCard from '@/components/workspace/OrchestratorCard.vue';

// types
import type { Orchestrator, Session } from '@/@types/index';
import type { CombinedItem, SessionListViewMode } from './types';

// -------------------------------------------------- Props --------------------------------------------------
defineProps<{
  bShowArchived: boolean;
  archivedCount: number;
  sessionsLoading: boolean;
  viewMode: SessionListViewMode;
  workspaceId: string;
  sessions: Session[];
  orchestrators: Orchestrator[];
  selectedIds: Set<string>;
  orchestratorSelectedIds: Set<string>;
  bSelectionActive: boolean;
  orderedNestedSessions: (orch: Orchestrator) => Session[];
  setListViewEl: (el: unknown) => void;
}>();

// -------------------------------------------------- Emits --------------------------------------------------
const emit = defineEmits<{
  'update:bShowArchived': [value: boolean];
  sessionContextMenu: [e: MouseEvent, session: Session];
  orchestratorContextMenu: [e: MouseEvent, orchestrator: Orchestrator];
  archive: [session: Session];
  archiveOrchestrator: [orchestrator: Orchestrator];
  delete: [item: CombinedItem];
  toggleSelect: [id: string];
  toggleSelectOrchestrator: [id: string];
}>();
</script>

<template>
  <div class="mt-6">
    <button
      class="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors font-medium select-none"
      :disabled="sessionsLoading"
      @click="emit('update:bShowArchived', !bShowArchived)"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        width="16"
        height="16"
        class="transition-transform duration-200"
        :class="bShowArchived ? 'rotate-90' : ''"
        aria-hidden="true"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
      Archived
      <span class="text-xs bg-fg/[0.07] border border-fg/[0.1] rounded-full px-2 py-0.5">{{
        archivedCount
      }}</span>
    </button>

    <Transition name="fade">
      <div v-if="bShowArchived" class="mt-4">
        <div class="grid-view" v-if="viewMode === 'grid'">
          <TransitionGroup name="list-stagger" tag="div" class="grid-view-items">
            <SessionCard
              v-for="(session, index) in sessions"
              :key="'arch-' + session.id"
              :session="session"
              :workspace-id="workspaceId"
              b-grid
              b-archived
              :style="{ '--stagger-index': index }"
              @contextmenu.prevent.stop="emit('sessionContextMenu', $event, session)"
              @archive="emit('archive', session)"
              @delete="emit('delete', { kind: 'session', session })"
            />
          </TransitionGroup>

          <template v-if="orchestrators.length > 0">
            <p
              v-if="sessions.length > 0"
              class="text-xs font-medium text-text-muted mt-6 mb-2"
            >
              Orchestrators
            </p>
            <TransitionGroup name="list-stagger" tag="div" class="grid-view-items">
              <OrchestratorCard
                v-for="(orch, index) in orchestrators"
                :key="'arch-orch-' + orch.id"
                :orchestrator="orch"
                :workspace-id="workspaceId"
                b-grid
                b-archived
                :style="{ '--stagger-index': index }"
                @contextmenu.prevent.stop="emit('orchestratorContextMenu', $event, orch)"
                @archive="emit('archiveOrchestrator', orch)"
                @delete="
                  emit('delete', {
                    kind: 'orchestrator',
                    orchestrator: orch,
                    nestedSessions: orderedNestedSessions(orch)
                  })
                "
              />
            </TransitionGroup>
          </template>
        </div>

        <div v-else class="list-view" :ref="setListViewEl">
          <TransitionGroup name="list-stagger" tag="div" class="list-view-items">
            <SessionCard
              v-for="(session, index) in sessions"
              :key="'arch-' + session.id"
              :session="session"
              :workspace-id="workspaceId"
              :b-selected="selectedIds.has(session.id)"
              :b-selection-active="bSelectionActive"
              b-archived
              :style="{ '--stagger-index': index }"
              @contextmenu.prevent.stop="emit('sessionContextMenu', $event, session)"
              @archive="emit('archive', session)"
              @delete="emit('delete', { kind: 'session', session })"
              @toggle-select="emit('toggleSelect', session.id)"
            />
          </TransitionGroup>

          <template v-if="orchestrators.length > 0">
            <p
              v-if="sessions.length > 0"
              class="text-xs font-medium text-text-muted mt-6 mb-2 px-2"
            >
              Orchestrators
            </p>
            <TransitionGroup name="list-stagger" tag="div" class="list-view-items">
              <div
                v-for="(orch, oix) in orchestrators"
                :key="'arch-orch-' + orch.id"
                :style="{ '--stagger-index': oix }"
                class="flex flex-col"
              >
                <OrchestratorCard
                  :orchestrator="orch"
                  :workspace-id="workspaceId"
                  :b-selected="orchestratorSelectedIds.has(orch.id)"
                  :b-selection-active="bSelectionActive"
                  b-archived
                  @contextmenu.prevent.stop="emit('orchestratorContextMenu', $event, orch)"
                  @archive="emit('archiveOrchestrator', orch)"
                  @delete="
                    emit('delete', {
                      kind: 'orchestrator',
                      orchestrator: orch,
                      nestedSessions: orderedNestedSessions(orch)
                    })
                  "
                  @toggle-select="emit('toggleSelectOrchestrator', orch.id)"
                />

                <SessionCard
                  v-for="child in orderedNestedSessions(orch)"
                  :key="'arch-orch-' + orch.id + '-sub-' + child.id"
                  :session="child"
                  :workspace-id="workspaceId"
                  b-nested
                  b-archived
                  @contextmenu.prevent.stop="emit('sessionContextMenu', $event, child)"
                />
              </div>
            </TransitionGroup>
          </template>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
