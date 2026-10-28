// @vitest-environment jsdom
// node_modules
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

vi.mock('@/classes/api', () => ({
  sessionsApi: {
    update: vi.fn()
  },
  isGloballyToasted: () => false
}));

// classes
import { sessionsApi } from '@/classes/api';

// composables
import { normalizeApprovalPolicy, useApprovalPolicy } from './useApprovalPolicy';

// types
import type { Session } from '@/@types/index';

describe('useApprovalPolicy', () => {
  beforeEach(() => {
    vi.mocked(sessionsApi.update).mockReset();
  });

  it('normalizes unknown policies to ask', () => {
    expect(normalizeApprovalPolicy('allow_all')).toBe('allow_all');
    expect(normalizeApprovalPolicy('bogus')).toBe('ask');
    expect(normalizeApprovalPolicy(null)).toBe('ask');
  });

  it('rolls back the policy and session when the save fails', async () => {
    vi.mocked(sessionsApi.update).mockRejectedValueOnce(new Error('boom'));
    const original = { id: 's1', approvalPolicy: 'ask' } as Session;
    const session = ref<Session | null>(original);
    const toastStore = { error: vi.fn() };
    const policy = useApprovalPolicy({
      workspaceId: () => 'w1',
      sessionId: () => 's1',
      session,
      toastStore
    });

    await policy.onApprovalPolicyChange('allow_all');

    expect(policy.approvalPolicy.value).toBe('ask');
    expect(session.value).toEqual(original);
    expect(policy.bSavingApprovalPolicy.value).toBe(false);
    expect(toastStore.error).toHaveBeenCalledWith('Failed to update approval policy');
  });
});
