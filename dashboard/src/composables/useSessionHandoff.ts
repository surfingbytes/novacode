/**
 * "Continue in new chat" — hands the conversation off to a new session and links the two.
 * Extracted from SessionChat.vue.
 */

// node_modules
import { computed, ref, watch, type Ref } from 'vue';
import type { Router } from 'vue-router';

// classes
import { apiErrorMessage, sessionsApi } from '@/classes/api';
import { clearSessionPrompt } from '@/lib/pendingSessionPrompt';

// types
import type { PendingAttachment } from '@/components/chat/ChatComposer.vue';
import type { Session } from '@/@types/index';

// -------------------------------------------------- Types --------------------------------------------------

export interface UseSessionHandoffOptions {
  workspaceId: () => string;
  sessionId: () => string;
  session: Ref<Session | null>;
  router: Router;
  workspacesStore: { allSessions: Session[] };
  toastStore: { error: (message: string) => void };
  promptText: Ref<string>;
  pendingImages: Ref<PendingAttachment[]>;
}

export function useSessionHandoff(options: UseSessionHandoffOptions) {
  const { promptText, pendingImages } = options;

  // -------------------------------------------------- Refs --------------------------------------------------
  const bHandoffPending = ref(false);
  /** Draft taken from the composer when the handoff started; put back if it fails. */
  let handoffDraft: { text: string; images: PendingAttachment[] } | null = null;

  const storeSession = computed(() =>
    options.workspacesStore.allSessions.find((candidate) => candidate.id === options.sessionId())
  );
  const continuedFrom = computed(
    () => storeSession.value?.continuedFrom ?? options.session.value?.continuedFrom ?? null
  );
  const continuedInSessionId = computed(
    () =>
      storeSession.value?.continuedInSessionId ??
      options.session.value?.continuedInSessionId ??
      null
  );
  const continuedInSessionName = computed(() => {
    const id = continuedInSessionId.value;
    if (!id) return '';
    return (
      options.workspacesStore.allSessions.find((candidate) => candidate.id === id)?.name?.trim() ||
      'Untitled session'
    );
  });
  const bHandoffSummaryOpen = ref(false);

  // -------------------------------------------------- Methods --------------------------------------------------
  async function onContinueInNewChat(payload: {
    text: string;
    imagePaths: string[];
  }): Promise<void> {
    if (bHandoffPending.value) return;
    bHandoffPending.value = true;
    try {
      await sessionsApi.continueInNewChat(options.workspaceId(), options.sessionId(), payload);
      handoffDraft = { text: promptText.value, images: pendingImages.value };
      promptText.value = '';
      pendingImages.value = [];
      clearSessionPrompt(options.workspaceId(), options.sessionId());
    } catch (err) {
      bHandoffPending.value = false;
      options.toastStore.error(apiErrorMessage(err, 'Failed to continue in new chat'));
    }
  }

  function openHandoffTarget(newSessionId: string): void {
    if (!bHandoffPending.value) return;
    bHandoffPending.value = false;
    handoffDraft = null;
    void options.router.push({
      name: 'session',
      params: { id: options.workspaceId(), sessionId: newSessionId }
    });
  }

  function failHandoff(message: string): void {
    if (!bHandoffPending.value) return;
    bHandoffPending.value = false;
    if (handoffDraft && !promptText.value.trim() && pendingImages.value.length === 0) {
      promptText.value = handoffDraft.text;
      pendingImages.value = handoffDraft.images;
    }
    handoffDraft = null;
    options.toastStore.error(message);
  }

  function openContinuedSession(sessionId: string): void {
    void options.router.push({ name: 'session', params: { id: options.workspaceId(), sessionId } });
  }

  /** Drops any in-flight handoff state (the chat switched to another session). */
  function resetHandoff(): void {
    bHandoffPending.value = false;
    bHandoffSummaryOpen.value = false;
    handoffDraft = null;
  }

  // -------------------------------------------------- Watchers --------------------------------------------------
  // Fallback when the handoff-ready frame was missed (socket reconnect): the
  // session list upsert still links this chat to the new one.
  watch(continuedInSessionId, (id, previousId) => {
    if (id && id !== previousId) openHandoffTarget(id);
  });

  return {
    // data
    bHandoffPending,
    storeSession,
    continuedFrom,
    continuedInSessionId,
    continuedInSessionName,
    bHandoffSummaryOpen,
    // methods
    onContinueInNewChat,
    openHandoffTarget,
    failHandoff,
    openContinuedSession,
    resetHandoff
  };
}

export type UseSessionHandoff = ReturnType<typeof useSessionHandoff>;
