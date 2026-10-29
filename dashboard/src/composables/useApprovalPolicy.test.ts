// @vitest-environment jsdom
// node_modules
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

vi.mock('@/classes/api', () => ({
  sessionsApi: {
    update: vi.fn()
  }
}));

vi.mock('@/lib/notifyApiError', () => ({
  notifyApiError: vi.fn()
}));

// classes
import { sessionsApi } from '@/classes/api';

// lib
import { notifyApiError } from '@/lib/notifyApiError';

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
    const err = new Error('boom');
    vi.mocked(sessionsApi.update).mockRejectedValueOnce(err);
    const original = { id: 's1', approvalPolicy: 'ask' } as Session;
    const session = ref<Session | null>(original);
    const policy = useApprovalPolicy({
      workspaceId: () => 'w1',
      sessionId: () => 's1',
      session
    });

    await policy.onApprovalPolicyChange('allow_all');

    expect(policy.approvalPolicy.value).toBe('ask');
    expect(session.value).toEqual(original);
    expect(policy.bSavingApprovalPolicy.value).toBe(false);
    expect(notifyApiError).toHaveBeenCalledWith(err, 'Failed to update approval policy');
  });
});
