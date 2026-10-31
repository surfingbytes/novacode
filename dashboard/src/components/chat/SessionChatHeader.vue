<script setup lang="ts">
/**
 * Session header: title, workspace switcher, favorite + orchestrator buttons and
 * the CI / cost / rules subtitle trailing. Extracted from SessionChat.vue.
 */
// node_modules
import { ref } from 'vue';
import { CircleCheck, CircleSlash, CircleX, Clock, LoaderCircle } from 'lucide-vue-next';
import type { RouteLocationRaw } from 'vue-router';

// components
import EntityDetailHeader from '@/components/ui/EntityDetailHeader.vue';
import FavoriteButton from '@/components/ui/FavoriteButton.vue';
import SessionOrchestratorButton from '@/components/chat/SessionOrchestratorButton.vue';
import SessionOrchestratorMenuItems from '@/components/chat/SessionOrchestratorMenuItems.vue';

// types
import type { Session } from '@/@types/index';
import type { CiBadgeState } from '@/utils/ciStatusDisplay';

// -------------------------------------------------- Props --------------------------------------------------

defineProps<{
  session: Session | null;
  workspaceId: string;
  workspaceName: string;
  subtitleWorkspaces: Array<{ id: string; name: string }>;
  bLoading: boolean;
  bShowSidebarToggle?: boolean;
  /** Id of the orchestrator plan this chat owns, if any. */
  plannedOrchestratorId: string | null;
  bPlanHasSteps: boolean;
  headerCiState: CiBadgeState;
  headerCiTitle: string;
  sessionCostLabel: string | null;
  sessionCostTitle: string | null;
  /** Subscription usage left (Claude windows / Cursor credit) — shown before the cost. */
  accountUsageLabel: string | null;
  accountUsageTitle: string | null;
  rulesSubtitleLabel: string | null;
  rulesSubtitleTitle: string;
  rulesSubtitleTo: RouteLocationRaw;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'toggle-sidebar'): void;
  (e: 'new-session'): void;
  (e: 'edit'): void;
  (e: 'export'): void;
  (e: 'select-subtitle', id: string): void;
  (e: 'archive'): void;
  (e: 'delete'): void;
  (e: 'toggle-favorite'): void;
  /** Send the "plan as orchestrator" prompt into the chat. */
  (e: 'plan'): void;
  /** Show the Orchestrator tab. */
  (e: 'open-plan'): void;
  /** Open the orchestrator's full page. */
  (e: 'open-page'): void;
  /** CI badge clicked — show the Git tab. */
  (e: 'open-git'): void;
}>();

// -------------------------------------------------- Refs --------------------------------------------------

/** The button hides below lg but stays mounted — it owns the spec modal the mobile menu opens. */
const orchestratorButtonRef = ref<InstanceType<typeof SessionOrchestratorButton>>();
</script>

<template>
  <EntityDetailHeader
    :title="session?.name?.trim() || 'Untitled session'"
    :subtitle="workspaceName"
    :subtitle-items="subtitleWorkspaces"
    :current-subtitle-id="workspaceId"
    :tags="session?.tags ?? []"
    :b-loading="bLoading"
    :archived="session?.archived ?? false"
    :b-show-sidebar-toggle="bShowSidebarToggle"
    :show-new-session="true"
    :show-export="true"
    @toggle-sidebar="emit('toggle-sidebar')"
    @new-session="emit('new-session')"
    @edit="emit('edit')"
    @export="emit('export')"
    @select-subtitle="(id) => emit('select-subtitle', id)"
    @archive="emit('archive')"
    @delete="emit('delete')"
  >
    <template v-if="session && !session.archived" #title-trailing>
      <FavoriteButton :b-favorite="!!session.isFavorite" @toggle="emit('toggle-favorite')" />
    </template>
    <template v-if="session && !session.archived" #actions-leading>
      <SessionOrchestratorButton
        ref="orchestratorButtonRef"
        :workspace-id="workspaceId"
        :session-id="session.id"
        :orchestrator-id="plannedOrchestratorId"
        :b-has-steps="bPlanHasSteps"
        @plan="emit('plan')"
        @open-plan="emit('open-plan')"
        @open-page="emit('open-page')"
      />
    </template>
    <template v-if="session && !session.archived" #mobile-menu-leading="{ close }">
      <SessionOrchestratorMenuItems
        :session-id="session.id"
        :orchestrator-id="plannedOrchestratorId"
        :b-has-steps="bPlanHasSteps"
        @plan="close(); emit('plan')"
        @open-plan="close(); emit('open-plan')"
        @open-page="close(); emit('open-page')"
        @open-spec="close(); orchestratorButtonRef?.openSpec()"
      />
    </template>
    <template #subtitle-trailing>
      <template v-if="headerCiState !== 'none'">
        <span class="text-text-muted/40 shrink-0" aria-hidden="true">·</span>
        <button
          type="button"
          class="inline-flex shrink-0 items-center gap-1 hover:text-text-primary"
          :title="headerCiTitle"
          :aria-label="headerCiTitle"
          @click="emit('open-git')"
        >
          <LoaderCircle v-if="headerCiState === 'running'" :size="12" :stroke-width="2" class="text-primary animate-spin" aria-hidden="true" />
          <Clock v-else-if="headerCiState === 'queued'" :size="12" :stroke-width="2" aria-hidden="true" />
          <CircleCheck v-else-if="headerCiState === 'success'" :size="12" :stroke-width="2" class="text-success" aria-hidden="true" />
          <CircleX v-else-if="headerCiState === 'failure'" :size="12" :stroke-width="2" class="text-destructive" aria-hidden="true" />
          <CircleSlash v-else :size="12" :stroke-width="2" aria-hidden="true" />
          <span>CI</span>
        </button>
      </template>
      <template v-if="accountUsageLabel">
        <span class="text-text-muted/40 shrink-0" aria-hidden="true">·</span>
        <span class="shrink-0 tabular-nums" :title="accountUsageTitle ?? accountUsageLabel">{{ accountUsageLabel }}</span>
      </template>
      <template v-if="sessionCostLabel">
        <span class="text-text-muted/40 shrink-0" aria-hidden="true">·</span>
        <span
          class="shrink-0 tabular-nums"
          :class="{ 'text-text-muted/60': accountUsageLabel }"
          :title="`Session cost: ${sessionCostTitle ?? sessionCostLabel}`"
        >{{ sessionCostLabel }}</span>
      </template>
      <RouterLink
        v-if="rulesSubtitleLabel"
        :to="rulesSubtitleTo"
        class="inline-flex items-center gap-1 min-w-0 hover:text-text-primary"
        :title="rulesSubtitleTitle"
      >
        <span class="text-text-muted/40 shrink-0" aria-hidden="true">·</span>
        <span class="truncate">{{ rulesSubtitleLabel }}</span>
      </RouterLink>
    </template>
  </EntityDetailHeader>
</template>
