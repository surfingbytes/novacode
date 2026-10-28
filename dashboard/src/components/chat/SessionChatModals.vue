<script setup lang="ts">
/**
 * Session chat modals: edit session, delete session and delete plan confirmations.
 * Extracted from SessionChat.vue.
 */
// components
import ConfirmModal from '@/components/ConfirmModal.vue';
import SessionEditModal from '@/components/SessionEditModal.vue';

// types
import type { Session } from '@/@types/index';
import type { PlanDocument } from '@/utils/planDocuments';

// -------------------------------------------------- Props --------------------------------------------------

defineProps<{
  session: Session | null;
  bSavingEdit: boolean;
  /** Tags used in this workspace (edit modal autocomplete). */
  existingTags: string[];
  bDeletingSession: boolean;
  selectedPlanDocument: PlanDocument | null;
  bDeletingPlan: boolean;
}>();

const bShowEditModal = defineModel<boolean>('bShowEditModal', { required: true });
const bShowDeleteModal = defineModel<boolean>('bShowDeleteModal', { required: true });
const bShowDeletePlanModal = defineModel<boolean>('bShowDeletePlanModal', { required: true });

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'save-session', payload: { name: string; tags?: string[] | null }): void;
  (e: 'delete-session'): void;
  (e: 'delete-plan'): void;
}>();
</script>

<template>
  <SessionEditModal
    v-model="bShowEditModal"
    :session="session"
    :loading="bSavingEdit"
    :existing-tags="existingTags"
    @save="(payload) => emit('save-session', payload)"
  />

  <ConfirmModal
    v-model="bShowDeleteModal"
    title="Delete session"
    eyebrow="// delete session"
    :description="`Delete '${session?.name ?? 'this session'}'? The chat history will be permanently removed.`"
    confirm-label="Delete"
    :loading="bDeletingSession"
    @confirm="emit('delete-session')"
  />

  <ConfirmModal
    v-model="bShowDeletePlanModal"
    title="Delete plan"
    eyebrow="// delete plan"
    :description="
      selectedPlanDocument?.backendPlanId
        ? `Delete '${selectedPlanDocument.title}'? The plan file will be permanently removed.`
        : `Remove '${selectedPlanDocument?.title ?? 'this plan'}' from the Plan tab?`
    "
    confirm-label="Delete"
    :loading="bDeletingPlan"
    @confirm="emit('delete-plan')"
  />
</template>
