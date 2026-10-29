// @vitest-environment jsdom
// node_modules
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive, ref } from 'vue';
import type { Router } from 'vue-router';

vi.mock('@/classes/api', () => ({
  sessionsApi: {
    continueInNewChat: vi.fn()
  },
}));

vi.mock('@/lib/notifyApiError', () => ({
  notifyApiError: vi.fn()
}));

// classes
import { sessionsApi } from '@/classes/api';

// lib
import { notifyApiError } from '@/lib/notifyApiError';

// composables
import { useSessionHandoff } from './useSessionHandoff';

// types
import type { Session } from '@/@types/index';

function mountHandoff(allSessions: Partial<Session>[], session: Partial<Session> | null = null) {
  const workspacesStore = reactive({ allSessions: allSessions as Session[] });
  const toastStore = { error: vi.fn() };
  const router = { push: vi.fn() } as unknown as Router;
  const promptText = ref('draft text');
  const pendingImages = ref([
    { filename: 'a.png', displayName: 'a.png', dataUrl: '', serverPath: '/a.png', isImage: true }
  ]);
  const handoff = useSessionHandoff({
    workspaceId: () => 'w1',
    sessionId: () => 's1',
    session: ref(session as Session | null),
    router,
    workspacesStore,
    toastStore,
    promptText,
    pendingImages
  });
  return { handoff, workspacesStore, toastStore, router, promptText, pendingImages };
}

describe('useSessionHandoff', () => {
  beforeEach(() => {
    vi.mocked(sessionsApi.continueInNewChat).mockReset();
    vi.mocked(notifyApiError).mockReset();
  });

  it('reports a failed handoff request through notifyApiError', async () => {
    const err = new Error('boom');
    vi.mocked(sessionsApi.continueInNewChat).mockRejectedValueOnce(err);
    const { handoff, toastStore, promptText } = mountHandoff([{ id: 's1' }]);
    await handoff.onContinueInNewChat({ text: 'go', imagePaths: [] });
    expect(handoff.bHandoffPending.value).toBe(false);
    expect(promptText.value).toBe('draft text');
    expect(notifyApiError).toHaveBeenCalledWith(err, 'Failed to continue in new chat');
    expect(toastStore.error).not.toHaveBeenCalled();
  });

  it('names the continued-in session from the store, with a fallback for blank names', () => {
    const { handoff, workspacesStore } = mountHandoff([
      { id: 's1', continuedInSessionId: 's2' },
      { id: 's2', name: '  Next chat  ' }
    ]);
    expect(handoff.continuedInSessionId.value).toBe('s2');
    expect(handoff.continuedInSessionName.value).toBe('Next chat');

    workspacesStore.allSessions[1].name = '   ';
    expect(handoff.continuedInSessionName.value).toBe('Untitled session');
  });

  it('is empty when the chat was not continued', () => {
    const { handoff } = mountHandoff([{ id: 's1' }]);
    expect(handoff.continuedInSessionId.value).toBeNull();
    expect(handoff.continuedInSessionName.value).toBe('');
  });

  it('falls back to the fetched session when the store has no link', () => {
    const { handoff } = mountHandoff([{ id: 's2', name: 'Next' }], { continuedInSessionId: 's2' });
    expect(handoff.continuedInSessionName.value).toBe('Next');
  });

  it('puts the composer draft back when the handoff fails', async () => {
    vi.mocked(sessionsApi.continueInNewChat).mockResolvedValueOnce({} as never);
    const { handoff, toastStore, promptText, pendingImages } = mountHandoff([{ id: 's1' }]);
    await handoff.onContinueInNewChat({ text: 'go', imagePaths: [] });
    expect(handoff.bHandoffPending.value).toBe(true);
    expect(promptText.value).toBe('');
    expect(pendingImages.value).toEqual([]);

    handoff.failHandoff('Summary failed');
    expect(handoff.bHandoffPending.value).toBe(false);
    expect(promptText.value).toBe('draft text');
    expect(pendingImages.value).toHaveLength(1);
    expect(toastStore.error).toHaveBeenCalledWith('Summary failed');
  });

  it('opens the new session when the store links it while a handoff is pending', async () => {
    vi.mocked(sessionsApi.continueInNewChat).mockResolvedValueOnce({} as never);
    const { handoff, workspacesStore, router } = mountHandoff([{ id: 's1' }]);
    await handoff.onContinueInNewChat({ text: 'go', imagePaths: [] });

    workspacesStore.allSessions[0].continuedInSessionId = 's9';
    await nextTick();

    expect(router.push).toHaveBeenCalledWith({
      name: 'session',
      params: { id: 'w1', sessionId: 's9' }
    });
    expect(handoff.bHandoffPending.value).toBe(false);
  });
});
