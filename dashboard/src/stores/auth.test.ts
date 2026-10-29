// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useAuthStore } from '@/stores/auth';
import { useOrchestratorsStore } from '@/stores/orchestrators';
import { useSessionSpecsStore } from '@/stores/sessionSpecs';
import { useToastStore } from '@/stores/toasts';
import { useWorkspacesStore } from '@/stores/workspaces';

vi.mock('@/classes/api', () => ({
  authApi: {
    login: vi.fn(() => Promise.resolve({ data: {} })),
    logout: vi.fn(() => Promise.resolve({ data: {} })),
    validate: vi.fn()
  },
  workspaceApi: {},
  sessionsApi: {},
  orchestratorApi: {},
  sessionSpecApi: {},
  buildSessionsWsUrl: () => 'ws://localhost/api/ws/sessions',
  isApiUnreachableError: () => false
}));

describe('auth store logout', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('resets every data store', () => {
    const resets = [
      vi.spyOn(useWorkspacesStore(), 'reset'),
      vi.spyOn(useOrchestratorsStore(), 'reset'),
      vi.spyOn(useSessionSpecsStore(), 'reset'),
      vi.spyOn(useToastStore(), 'reset')
    ];

    useAuthStore().logout();

    for (const reset of resets) {
      expect(reset).toHaveBeenCalledTimes(1);
    }
  });

  it('clears signed-in state, session caches and drafts but keeps UI preferences', () => {
    localStorage.setItem('nova:signedIn', '1');
    localStorage.setItem('nova:sessionCache:w1:s1', '{"version":1}');
    localStorage.setItem('nova:sessionCache:w2:s2', '{"version":1}');
    localStorage.setItem('sessionPrompt:w1:s1', 'draft');
    localStorage.setItem('orchestratorPrompt:w1:o1', 'draft');
    localStorage.setItem('nova:draftPromptIndex', '["sessionPrompt:w1:s1"]');
    localStorage.setItem('novacode:filesOpenPath:w1', 'src/secret.ts');
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('nova:chat:sendOnEnter', '0');
    localStorage.setItem('sessionsViewMode', 'grid');
    const auth = useAuthStore();

    auth.logout();

    expect(auth.bSignedIn).toBe(false);
    expect(Object.keys(localStorage).sort()).toEqual(['nova:chat:sendOnEnter', 'sessionsViewMode', 'theme']);
  });

  it('empties store data on logout', () => {
    const workspaces = useWorkspacesStore();
    const orchestrators = useOrchestratorsStore();
    const toasts = useToastStore();
    workspaces.activeWorkspaceId = 'w1';
    orchestrators.applySummaries([{ id: 'o1', workspaceId: 'w1' } as never]);
    toasts.info('hello');

    useAuthStore().logout();

    expect(workspaces.activeWorkspaceId).toBeNull();
    expect(orchestrators.orchestratorsByWorkspace).toEqual({});
    expect(toasts.toasts).toEqual([]);
  });
});
