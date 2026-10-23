import { ref } from 'vue';

const viewingSessionId = ref<string | null>(null);

export function setViewingSession(sessionId: string | null): void {
  viewingSessionId.value = sessionId;
}

export function isViewingSession(sessionId: string): boolean {
  return viewingSessionId.value === sessionId;
}

/** Unread comes from the session row (DB). Viewing the chat hides the badge on this device immediately. */
export function isSessionUnread(session: { id: string; unread?: boolean }): boolean {
  if (!session.unread) {
    return false;
  }
  return viewingSessionId.value !== session.id;
}

const viewingOrchestratorId = ref<string | null>(null);

export function setViewingOrchestrator(orchestratorId: string | null): void {
  viewingOrchestratorId.value = orchestratorId;
}

export function isViewingOrchestrator(orchestratorId: string): boolean {
  return viewingOrchestratorId.value === orchestratorId;
}

/** Finished run nobody opened yet; viewing the plan hides the badge on this device immediately. */
export function isOrchestratorUnread(orchestrator: { id: string; unread?: boolean }): boolean {
  return !!orchestrator.unread && viewingOrchestratorId.value !== orchestrator.id;
}

export function resetSessionUnreadState(): void {
  viewingSessionId.value = null;
  viewingOrchestratorId.value = null;
}
