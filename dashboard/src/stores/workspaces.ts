// node_modules
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

// classes
import { sessionsApi, workspaceApi, buildSessionsWsUrl } from '@/classes/api';
import { createManagedSocket, type ManagedSocket } from '@/lib/wsClient';

// stores
import { useOrchestratorsStore } from '@/stores/orchestrators';

// types
import type { Workspace, CreateWorkspacePayload, UpdateWorkspacePayload, Session, Orchestrator } from '@/@types/index';

export const useWorkspacesStore = defineStore('workspaces', () => {
  // -------------------------------------------------- Refs --------------------------------------------------
  const workspaces = ref<Workspace[]>([]);
  const bIsLoading = ref<boolean>(false);

  // Sessions (global + active workspace derived views)
  const activeWorkspaceId = ref<string | null>(null);
  const allSessions = ref<Session[]>([]);
  const bSessionsLoading = ref<boolean>(false);

  let sessionSocket: ManagedSocket | null = null;
  let sessionsInitialized = false;

  // -------------------------------------------------- Computed --------------------------------------------------
  const activeSessions = computed<Session[]>(() => {
    const workspaceId = activeWorkspaceId.value;
    if (!workspaceId) {
      return [];
    }
    return allSessions.value.filter((session) => session.workspaceId === workspaceId && !session.archived);
  });

  const archivedSessions = computed<Session[]>(() => {
    const workspaceId = activeWorkspaceId.value;
    if (!workspaceId) {
      return [];
    }
    return allSessions.value.filter((session) => session.workspaceId === workspaceId && session.archived);
  });

  const activeBusySessions = computed<Session[]>(() =>
    allSessions.value
      .filter((session) => !session.archived && session.busy)
      .sort(
        (leftSession, rightSession) =>
          new Date(rightSession.updatedAt).getTime() - new Date(leftSession.updatedAt).getTime()
      )
  );

  // -------------------------------------------------- Methods --------------------------------------------------
  const fetchAll = async (): Promise<void> => {
    bIsLoading.value = true;
    try {
      const response = await workspaceApi.listAll();
      workspaces.value = response.data;
    } finally {
      bIsLoading.value = false;
    }
  };

  function upsertSession(next: Session): void {
    const sessionIndex = allSessions.value.findIndex((session) => session.id === next.id);
    const previousSession = sessionIndex === -1 ? null : allSessions.value[sessionIndex];
    const merged: Session = {
      ...(previousSession ?? {}),
      ...next,
      messageJson:
        typeof next.messageJson === 'string' && next.messageJson.length > 0
          ? next.messageJson
          : (previousSession?.messageJson ?? '[]'),
    };
    if (sessionIndex === -1) {
      allSessions.value = [merged, ...allSessions.value];
      return;
    }
    const updated = [...allSessions.value];
    updated[sessionIndex] = merged;
    allSessions.value = updated;
  }

  function removeSession(sessionId: string): void {
    allSessions.value = allSessions.value.filter((session) => session.id !== sessionId);
  }

  function setSessionBusy(sessionId: string, busy: boolean): void {
    allSessions.value = allSessions.value.map((session) =>
      session.id === sessionId ? { ...session, busy } : session
    );
  }

  const fetchAllSessions = async (): Promise<void> => {
    bSessionsLoading.value = true;
    try {
      const response = await sessionsApi.listAll();
      allSessions.value = response.data ?? [];
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
      allSessions.value = [];
    } finally {
      bSessionsLoading.value = false;
    }
  };

  function connectSessionSocket(): void {
    if (sessionSocket) {
      return;
    }
    sessionSocket = createManagedSocket({
      url: buildSessionsWsUrl(),
      onMessage: (data) => {
        try {
          const messagePayload = JSON.parse(data) as
            | { type: 'global-snapshot'; sessions: Session[] }
            | { type: 'session-upsert'; session: Session }
            | { type: 'session-deleted'; id: string; workspaceId?: string }
            | { type: 'busy-changed'; id: string; busy: boolean }
            | { type: 'orchestrator-upsert'; orchestrator: Orchestrator }
            | { type: 'refresh' }
            | { type: 'server-shutdown' }
            | { type: 'ping' };

          if (messagePayload.type === 'global-snapshot') {
            allSessions.value = messagePayload.sessions ?? [];
          } else if (messagePayload.type === 'session-upsert') {
            if (messagePayload.session) {
              upsertSession(messagePayload.session);
            }
          } else if (messagePayload.type === 'session-deleted') {
            if (messagePayload.id) {
              removeSession(messagePayload.id);
            }
          } else if (messagePayload.type === 'busy-changed') {
            setSessionBusy(messagePayload.id, messagePayload.busy);
          } else if (messagePayload.type === 'orchestrator-upsert') {
            if (messagePayload.orchestrator) {
              useOrchestratorsStore().upsertOrchestrator(messagePayload.orchestrator);
            }
          } else if (messagePayload.type === 'refresh') {
            fetchAllSessions();
          } else if (messagePayload.type === 'server-shutdown') {
            // Managed socket reconnects with backoff; nothing else to do here.
          }
        } catch {
          // ignore malformed frames
        }
      }
    });
  }

  async function ensureSessionsInitialized(): Promise<void> {
    if (sessionsInitialized) {
      return;
    }
    await fetchAllSessions();
    connectSessionSocket();
    sessionsInitialized = true;
  }

  const setActiveWorkspace = async (workspaceId: string | null): Promise<void> => {
    activeWorkspaceId.value = workspaceId;
    await ensureSessionsInitialized();
  };

  const createWorkspace = async (payload: CreateWorkspacePayload): Promise<Workspace> => {
    const response = await workspaceApi.create(payload);
    workspaces.value.push(response.data);
    return response.data;
  };

  const updateWorkspace = async (id: string, payload: UpdateWorkspacePayload): Promise<void> => {
    const response = await workspaceApi.update(id, payload);
    const index = workspaces.value.findIndex((workspace) => workspace.id === id);
    if (index !== -1) {
      workspaces.value[index] = response.data;
    }
  };

  const archiveWorkspace = async (id: string, archived: boolean): Promise<void> => {
    const response = await workspaceApi.archive(id, archived);
    const index = workspaces.value.findIndex((workspace) => workspace.id === id);
    if (index !== -1) {
      workspaces.value[index] = response.data;
    }
  };

  const deleteWorkspace = async (id: string): Promise<void> => {
    await workspaceApi.remove(id);
    workspaces.value = workspaces.value.filter((workspace) => workspace.id !== id);
  };

  const reorderWorkspaces = async (ids: string[]): Promise<void> => {
    await workspaceApi.reorder(ids);
    const byId = new Map(workspaces.value.map((workspace) => [workspace.id, workspace]));
    workspaces.value = ids.map((id) => byId.get(id)).filter(Boolean) as Workspace[];
  };

  // -------------------------------------------------- Export --------------------------------------------------
  return {
    // data
    workspaces,
    bIsLoading,
    activeWorkspaceId,
    allSessions,
    activeSessions,
    archivedSessions,
    activeBusySessions,
    bSessionsLoading,
    // methods
    fetchAll,
    setActiveWorkspace,
    fetchAllSessions,
    ensureSessionsInitialized,
    createWorkspace,
    updateWorkspace,
    archiveWorkspace,
    deleteWorkspace,
    reorderWorkspaces
  };
});
