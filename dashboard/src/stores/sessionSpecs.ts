// node_modules
import { defineStore } from 'pinia';
import { ref } from 'vue';

// classes
import { sessionSpecApi } from '@/classes/api';

// types
import type { SessionSpecStatus } from '@/@types/index';

/**
 * Spec file status per session. Fetched on demand; changes (e.g. the agent
 * wrote the spec through the nova MCP) arrive over the sessions WebSocket as
 * `session-spec-status` frames (see workspaces store).
 */
export const useSessionSpecsStore = defineStore('sessionSpecs', () => {
  // -------------------------------------------------- Refs --------------------------------------------------
  const statusBySession = ref<Record<string, SessionSpecStatus>>({});

  // -------------------------------------------------- Methods --------------------------------------------------
  function forSession(sessionId: string): SessionSpecStatus | null {
    return statusBySession.value[sessionId] ?? null;
  }

  function applyStatus(status: SessionSpecStatus): void {
    statusBySession.value = { ...statusBySession.value, [status.sessionId]: status };
  }

  /** Fetch status and file content; content is returned, not stored. */
  async function fetchSpec(workspaceId: string, sessionId: string): Promise<string | null> {
    const { data } = await sessionSpecApi.get(workspaceId, sessionId);
    applyStatus(data.status);
    return data.content;
  }

  async function createSpec(workspaceId: string, sessionId: string): Promise<SessionSpecStatus> {
    const { data } = await sessionSpecApi.create(workspaceId, sessionId);
    applyStatus(data.status);
    return data.status;
  }

  /** Logout: drop cached spec status. */
  function reset(): void {
    statusBySession.value = {};
  }

  return {
    statusBySession,
    forSession,
    applyStatus,
    fetchSpec,
    createSpec,
    reset
  };
});
