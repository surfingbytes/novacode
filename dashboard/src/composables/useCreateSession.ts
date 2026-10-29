/**
 * New-session modal state and the create-session flow shared by every view
 * that opens NewSessionModal: create a session (or planning session), toast
 * the API error on failure, navigate to the new session on success.
 */

// node_modules
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';

// composables
import { useAgentCapabilities } from '@/composables/useAgentCapabilities';

// classes
import { apiErrorMessage, sessionsApi } from '@/classes/api';
import { createPlanningSession, type NewOrchestratorOptions } from '@/lib/createPlanningSession';
import { notifyApiError } from '@/lib/notifyApiError';

// types
import type { AgentType, ApprovalPolicy, Workspace } from '@/@types/index';

export type NewSessionMode = 'session' | 'orchestrator';

export interface CreateSessionPayload {
  name: string;
  tags?: string[] | null;
  agentType: AgentType;
  modelSelection?: string | null;
  approvalPolicy: ApprovalPolicy;
  orchestrator?: NewOrchestratorOptions;
}

export function useCreateSession() {
  const router = useRouter();
  const workspacesStore = useWorkspacesStore();
  const { ensureLoaded: ensureAgentCapabilitiesLoaded } = useAgentCapabilities();

  // -------------------------------------------------- Refs --------------------------------------------------
  const bShowNewSession = ref<boolean>(false);
  const newSessionWorkspace = ref<Workspace | undefined>(undefined);
  const newSessionMode = ref<NewSessionMode>('session');
  const bCreating = ref<boolean>(false);
  const createError = ref<string | null>(null);

  // -------------------------------------------------- Computed --------------------------------------------------
  /** Unique tags used by sessions of the target workspace (for autocomplete). */
  const newSessionTags = computed((): string[] => {
    const workspaceId = newSessionWorkspace.value?.id;
    if (!workspaceId) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const session of workspacesStore.allSessions) {
      if (session.workspaceId !== workspaceId) continue;
      const tags = session.tags;
      if (!tags?.length) continue;
      for (const tag of tags) {
        if (typeof tag !== 'string' || !tag.trim()) continue;
        const key = tag.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(tag.trim());
      }
    }
    return out.sort((a, b) => a.localeCompare(b));
  });

  // -------------------------------------------------- Methods --------------------------------------------------
  function openNewSession(workspace: Workspace, mode: NewSessionMode = 'session'): void {
    newSessionWorkspace.value = workspace;
    newSessionMode.value = mode;
    createError.value = null;
    ensureAgentCapabilitiesLoaded();
    bShowNewSession.value = true;
  }

  async function createSession(payload: CreateSessionPayload): Promise<void> {
    const workspace = newSessionWorkspace.value;
    if (!workspace || bCreating.value) return;
    bCreating.value = true;
    createError.value = null;
    try {
      const { orchestrator, ...sessionPayload } = payload;
      const sessionId = orchestrator
        ? await createPlanningSession(workspace.id, { ...payload, orchestrator })
        : (await sessionsApi.create(workspace.id, sessionPayload)).data.id;
      bShowNewSession.value = false;
      newSessionWorkspace.value = undefined;
      await router.push({
        name: 'session',
        params: { id: workspace.id, sessionId }
      });
    } catch (error) {
      createError.value = apiErrorMessage(error, 'Failed to create session');
      notifyApiError(error, 'Failed to create session');
    } finally {
      bCreating.value = false;
    }
  }

  return {
    bShowNewSession,
    newSessionWorkspace,
    newSessionMode,
    newSessionTags,
    bCreating,
    createError,
    openNewSession,
    createSession
  };
}
