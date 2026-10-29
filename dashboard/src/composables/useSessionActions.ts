/**
 * Session header actions — edit, export, archive, favorite and delete (session and plan).
 * Extracted from SessionChat.vue.
 */

// node_modules
import { ref, type ComputedRef, type Ref } from 'vue';
import type { Router } from 'vue-router';

// classes
import { sessionsApi } from '@/classes/api';
import { notifyApiError } from '@/lib/notifyApiError';
import { sessionChatToMarkdown, sessionExportFilename } from '@/utils/sessionChatMarkdown';

// types
import type { ChatMessage, Session } from '@/@types/index';
import type { PlanDocument } from '@/utils/chatDisplayItems';

// -------------------------------------------------- Types --------------------------------------------------

export interface UseSessionActionsOptions {
  workspaceId: () => string;
  sessionId: () => string;
  session: Ref<Session | null>;
  messages: Ref<ChatMessage[]>;
  workspaceName: () => string;
  selectedPlanDocument: ComputedRef<PlanDocument | null>;
  deletePlan: (plan: PlanDocument) => Promise<unknown>;
  router: Router;
  workspacesStore: { upsertSession: (session: Session) => void };
  toastStore: {
    info: (message: string) => void;
    success: (message: string) => void;
  };
}

export function useSessionActions(options: UseSessionActionsOptions) {
  const { session, toastStore } = options;

  // -------------------------------------------------- Refs --------------------------------------------------
  const bShowEditModal = ref(false);
  const bSavingEdit = ref(false);
  const bShowDeleteModal = ref(false);
  const bDeletingSession = ref(false);
  const bShowDeletePlanModal = ref(false);
  const bDeletingPlan = ref(false);

  // -------------------------------------------------- Methods --------------------------------------------------
  function openEditModal(): void {
    bShowEditModal.value = true;
  }

  function exportSessionMarkdown(): void {
    const title = session.value?.name?.trim() || 'Untitled session';
    const markdown = sessionChatToMarkdown(options.messages.value, {
      title,
      workspaceName: options.workspaceName()
    });
    if (!markdown.includes('\n## ')) {
      toastStore.info('Nothing to export yet');
      return;
    }
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sessionExportFilename(title);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toastStore.success('Exported Markdown');
  }

  async function saveSessionEdit(payload: { name: string; tags?: string[] | null }): Promise<void> {
    bSavingEdit.value = true;
    try {
      const { data: updated } = await sessionsApi.update(
        options.workspaceId(),
        options.sessionId(),
        payload
      );
      session.value = updated;
      options.workspacesStore.upsertSession(updated);
      bShowEditModal.value = false;
    } catch (err) {
      notifyApiError(err, 'Failed to update session');
    } finally {
      bSavingEdit.value = false;
    }
  }

  async function deleteSession(): Promise<void> {
    bDeletingSession.value = true;
    try {
      await sessionsApi.remove(options.workspaceId(), options.sessionId());
      await options.router.push({
        name: 'workspace-sessions',
        params: { id: options.workspaceId() }
      });
    } catch (err) {
      notifyApiError(err, 'Failed to delete session');
      bDeletingSession.value = false;
      bShowDeleteModal.value = false;
    }
  }

  async function deleteSelectedPlan(): Promise<void> {
    const plan = options.selectedPlanDocument.value;
    if (!plan) return;
    bDeletingPlan.value = true;
    try {
      await options.deletePlan(plan);
      bShowDeletePlanModal.value = false;
    } catch (err) {
      notifyApiError(err, 'Failed to delete plan');
    } finally {
      bDeletingPlan.value = false;
    }
  }

  async function toggleArchive(): Promise<void> {
    if (!session.value) return;
    try {
      const { data: updated } = await sessionsApi.update(
        options.workspaceId(),
        options.sessionId(),
        { archived: !session.value.archived }
      );
      session.value = updated;
      options.workspacesStore.upsertSession(updated);
    } catch (err) {
      notifyApiError(err, 'Failed to toggle archive');
    }
  }

  async function toggleFavorite(): Promise<void> {
    if (!session.value || session.value.archived) return;
    try {
      const { data: updated } = await sessionsApi.update(
        options.workspaceId(),
        options.sessionId(),
        { isFavorite: !session.value.isFavorite }
      );
      session.value = updated;
      options.workspacesStore.upsertSession(updated);
    } catch (err: unknown) {
      notifyApiError(err, 'Failed to update favorite');
    }
  }

  return {
    // data
    bShowEditModal,
    bSavingEdit,
    bShowDeleteModal,
    bDeletingSession,
    bShowDeletePlanModal,
    bDeletingPlan,
    // methods
    openEditModal,
    exportSessionMarkdown,
    saveSessionEdit,
    deleteSession,
    deleteSelectedPlan,
    toggleArchive,
    toggleFavorite
  };
}
