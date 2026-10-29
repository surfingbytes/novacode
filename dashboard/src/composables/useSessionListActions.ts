/**
 * Row actions for sessions in lists (workspace sidebar, session list) — one context menu
 * and one implementation of open / edit / favorite / clone / archive / delete.
 * Every mutation applies the API response to the workspaces store right away.
 */

// node_modules
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

// classes
import { sessionsApi } from '@/classes/api';
import { notifyApiError } from '@/lib/notifyApiError';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';

// types
import type { Session } from '@/@types/index';
import type { ContextMenuItem } from '@/components/ContextMenu.vue';

export function useSessionListActions() {
  const router = useRouter();
  const route = useRoute();
  const workspacesStore = useWorkspacesStore();

  // -------------------------------------------------- Refs --------------------------------------------------
  /** Session shown in the edit modal (null = closed). */
  const sessionToEdit = ref<Session | null>(null);
  const bSavingEdit = ref(false);
  /** Session awaiting delete confirmation (null = confirm dialog closed). */
  const sessionPendingDelete = ref<Session | null>(null);
  const bDeleting = ref(false);

  // -------------------------------------------------- Methods --------------------------------------------------
  function menuItems(session: Session): ContextMenuItem[] {
    const arch = session.archived === true;
    return [
      { key: 'open', label: 'Open', icon: 'open_in_new' },
      { key: 'edit', label: 'Edit…', icon: 'edit' },
      ...(arch
        ? []
        : [
            {
              key: 'favorite',
              label: session.isFavorite ? 'Remove favorite' : 'Add to favorites',
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

  function open(session: Session): void {
    void router.push({
      name: 'session',
      params: { id: session.workspaceId, sessionId: session.id }
    });
  }

  function edit(session: Session): void {
    sessionToEdit.value = session;
  }

  async function saveEdit(payload: { name: string; tags?: string[] | null }): Promise<void> {
    const session = sessionToEdit.value;
    if (!session) {
      return;
    }
    bSavingEdit.value = true;
    try {
      const { data } = await sessionsApi.update(session.workspaceId, session.id, payload);
      if (data) {
        workspacesStore.upsertSession(data);
      }
      sessionToEdit.value = null;
    } catch (err) {
      notifyApiError(err, 'Failed to update session');
    } finally {
      bSavingEdit.value = false;
    }
  }

  async function setArchived(session: Session, archived: boolean): Promise<void> {
    try {
      const { data } = await sessionsApi.update(session.workspaceId, session.id, { archived });
      if (data) {
        workspacesStore.upsertSession(data);
      }
    } catch (err) {
      notifyApiError(err, archived ? 'Failed to archive session' : 'Failed to unarchive session');
    }
  }

  function archive(session: Session): Promise<void> {
    return setArchived(session, true);
  }

  function unarchive(session: Session): Promise<void> {
    return setArchived(session, false);
  }

  /** Archive or unarchive depending on the current state (row buttons). */
  function toggleArchive(session: Session): Promise<void> {
    return setArchived(session, !session.archived);
  }

  async function toggleFavorite(session: Session): Promise<void> {
    if (session.archived) {
      return;
    }
    try {
      const { data } = await sessionsApi.update(session.workspaceId, session.id, {
        isFavorite: !session.isFavorite
      });
      if (data) {
        workspacesStore.upsertSession(data);
      }
    } catch (err) {
      notifyApiError(err, 'Failed to update favorite');
    }
  }

  /** Sessions have no server-side clone: start a new session with the same settings. */
  async function clone(session: Session): Promise<void> {
    try {
      const { data } = await sessionsApi.create(session.workspaceId, {
        name: `${session.name || 'Untitled session'} (copy)`,
        tags: session.tags,
        agentType: session.agentType,
        modelSelection: session.modelSelection,
        sessionMode: session.sessionMode,
        approvalPolicy: session.approvalPolicy
      });
      if (!data) {
        return;
      }
      workspacesStore.upsertSession(data);
      open(data);
    } catch (err) {
      notifyApiError(err, 'Failed to clone session');
    }
  }

  async function tryRemove(session: Session): Promise<boolean> {
    try {
      await sessionsApi.remove(session.workspaceId, session.id);
    } catch (err) {
      notifyApiError(err, 'Failed to delete session');
      return false;
    }
    workspacesStore.removeSession(session.id);
    if (route.params.sessionId === session.id) {
      void router.push({ name: 'workspace-sessions', params: { id: session.workspaceId } });
    }
    return true;
  }

  /** Delete without confirmation (callers confirm first — see `requestRemove`). */
  async function remove(session: Session): Promise<void> {
    await tryRemove(session);
  }

  /** Open the confirm dialog for `session`. */
  function requestRemove(session: Session): void {
    sessionPendingDelete.value = session;
  }

  /** Confirm-dialog handler: deletes the pending session. */
  async function confirmRemove(): Promise<void> {
    const session = sessionPendingDelete.value;
    if (!session) {
      return;
    }
    bDeleting.value = true;
    try {
      if (await tryRemove(session)) {
        sessionPendingDelete.value = null;
      }
    } finally {
      bDeleting.value = false;
    }
  }

  /** Dispatch a `menuItems` key. */
  function pick(session: Session, key: string): void {
    switch (key) {
      case 'open':
        open(session);
        break;
      case 'edit':
        edit(session);
        break;
      case 'favorite':
        void toggleFavorite(session);
        break;
      case 'clone':
        void clone(session);
        break;
      case 'archive':
        void archive(session);
        break;
      case 'unarchive':
        void unarchive(session);
        break;
      case 'delete':
        requestRemove(session);
        break;
    }
  }

  return {
    // data
    sessionToEdit,
    bSavingEdit,
    sessionPendingDelete,
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
