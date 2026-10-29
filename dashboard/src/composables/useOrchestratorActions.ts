/**
 * Row actions for orchestrators in lists (workspace sidebar, session list) — one context
 * menu and one implementation of open / edit / favorite / clone / archive / delete.
 * Every mutation goes through the orchestrators store (never into a derived array).
 */

// node_modules
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

// classes
import { orchestratorApi } from '@/classes/api';
import { notifyApiError } from '@/lib/notifyApiError';

// stores
import { useOrchestratorsStore } from '@/stores/orchestrators';

// types
import type { Orchestrator } from '@/@types/index';
import type { ContextMenuItem } from '@/components/ContextMenu.vue';

export function useOrchestratorActions() {
  const router = useRouter();
  const route = useRoute();
  const orchestratorsStore = useOrchestratorsStore();

  // -------------------------------------------------- Refs --------------------------------------------------
  /** Orchestrator shown in the rename modal (null = closed). */
  const orchestratorToEdit = ref<Orchestrator | null>(null);
  const bSavingEdit = ref(false);
  /** Orchestrator awaiting delete confirmation (null = confirm dialog closed). */
  const orchestratorPendingDelete = ref<Orchestrator | null>(null);
  const bDeleting = ref(false);

  // -------------------------------------------------- Methods --------------------------------------------------
  function menuItems(orchestrator: Orchestrator): ContextMenuItem[] {
    const arch = orchestrator.archived === true;
    return [
      { key: 'open', label: 'Open', icon: 'open_in_new' },
      { key: 'edit', label: 'Edit…', icon: 'edit' },
      ...(arch
        ? []
        : [
            {
              key: 'favorite',
              label: orchestrator.isFavorite ? 'Remove favorite' : 'Add to favorites',
              icon: 'star'
            }
          ]),
      { key: 'clone', label: 'Clone', icon: 'content_copy' },
      arch
        ? { key: 'unarchive', label: 'Unarchive', icon: 'unarchive' }
        : { key: 'archive', label: 'Archive', icon: 'inventory_2' },
      { key: 'delete', label: 'Delete…', icon: 'delete', danger: true }
    ];
  }

  function open(orchestrator: Orchestrator): void {
    void router.push({
      name: 'orchestrator',
      params: { id: orchestrator.workspaceId, orchestratorId: orchestrator.id }
    });
  }

  function edit(orchestrator: Orchestrator): void {
    orchestratorToEdit.value = orchestrator;
  }

  /** Rename-modal handler. */
  async function saveEdit(nextName: string): Promise<void> {
    const orchestrator = orchestratorToEdit.value;
    if (!orchestrator) {
      return;
    }
    const name = nextName.trim();
    if (!name || name === orchestrator.name) {
      orchestratorToEdit.value = null;
      return;
    }
    bSavingEdit.value = true;
    try {
      const { data } = await orchestratorApi.update(orchestrator.workspaceId, orchestrator.id, {
        name
      });
      if (data) {
        orchestratorsStore.upsertOrchestrator(data);
      }
      orchestratorToEdit.value = null;
    } catch (err) {
      notifyApiError(err, 'Failed to rename orchestrator');
    } finally {
      bSavingEdit.value = false;
    }
  }

  async function setArchived(orchestrator: Orchestrator, archived: boolean): Promise<void> {
    try {
      const { data } = await orchestratorApi.update(orchestrator.workspaceId, orchestrator.id, {
        archived
      });
      if (data) {
        orchestratorsStore.upsertOrchestrator(data);
      }
    } catch (err) {
      notifyApiError(
        err,
        archived ? 'Failed to archive orchestrator' : 'Failed to unarchive orchestrator'
      );
    }
  }

  function archive(orchestrator: Orchestrator): Promise<void> {
    return setArchived(orchestrator, true);
  }

  function unarchive(orchestrator: Orchestrator): Promise<void> {
    return setArchived(orchestrator, false);
  }

  /** Archive or unarchive depending on the current state (row buttons). */
  function toggleArchive(orchestrator: Orchestrator): Promise<void> {
    return setArchived(orchestrator, orchestrator.archived !== true);
  }

  async function toggleFavorite(orchestrator: Orchestrator): Promise<void> {
    if (orchestrator.archived === true) {
      return;
    }
    try {
      const { data } = await orchestratorApi.update(orchestrator.workspaceId, orchestrator.id, {
        isFavorite: !orchestrator.isFavorite
      });
      if (data) {
        orchestratorsStore.upsertOrchestrator(data);
      }
    } catch (err) {
      notifyApiError(err, 'Failed to update favorite');
    }
  }

  async function clone(orchestrator: Orchestrator): Promise<void> {
    try {
      const { data } = await orchestratorApi.clone(orchestrator.workspaceId, orchestrator.id);
      if (!data) {
        return;
      }
      orchestratorsStore.upsertOrchestrator(data);
      open(data);
    } catch (err) {
      notifyApiError(err, 'Failed to clone plan');
    }
  }

  async function tryRemove(orchestrator: Orchestrator): Promise<boolean> {
    try {
      await orchestratorApi.remove(orchestrator.workspaceId, orchestrator.id);
    } catch (err) {
      notifyApiError(err, 'Failed to delete orchestrator');
      return false;
    }
    orchestratorsStore.removeOrchestrator(orchestrator.id, orchestrator.workspaceId);
    if (route.params.orchestratorId === orchestrator.id) {
      void router.push({ name: 'workspace-sessions', params: { id: orchestrator.workspaceId } });
    }
    return true;
  }

  /** Delete without confirmation (callers confirm first — see `requestRemove`). */
  async function remove(orchestrator: Orchestrator): Promise<void> {
    await tryRemove(orchestrator);
  }

  /** Open the confirm dialog for `orchestrator`. */
  function requestRemove(orchestrator: Orchestrator): void {
    orchestratorPendingDelete.value = orchestrator;
  }

  /** Confirm-dialog handler: deletes the pending orchestrator. */
  async function confirmRemove(): Promise<void> {
    const orchestrator = orchestratorPendingDelete.value;
    if (!orchestrator) {
      return;
    }
    bDeleting.value = true;
    try {
      if (await tryRemove(orchestrator)) {
        orchestratorPendingDelete.value = null;
      }
    } finally {
      bDeleting.value = false;
    }
  }

  /** Dispatch a `menuItems` key. */
  function pick(orchestrator: Orchestrator, key: string): void {
    switch (key) {
      case 'open':
        open(orchestrator);
        break;
      case 'edit':
        edit(orchestrator);
        break;
      case 'favorite':
        void toggleFavorite(orchestrator);
        break;
      case 'clone':
        void clone(orchestrator);
        break;
      case 'archive':
        void archive(orchestrator);
        break;
      case 'unarchive':
        void unarchive(orchestrator);
        break;
      case 'delete':
        requestRemove(orchestrator);
        break;
    }
  }

  return {
    // data
    orchestratorToEdit,
    bSavingEdit,
    orchestratorPendingDelete,
    bDeleting,
    // methods
    menuItems,
    open,
    edit,
    saveEdit,
    archive,
    unarchive,
    toggleArchive,
    remove,
    requestRemove,
    confirmRemove,
    clone,
    toggleFavorite,
    pick
  };
}
