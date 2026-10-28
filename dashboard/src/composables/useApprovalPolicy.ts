/**
 * Per-session tool approval policy (Ask / Allow all) with optimistic save.
 * Extracted from SessionChat.vue.
 */

// node_modules
import { ref, type Ref } from 'vue';

// classes
import { isGloballyToasted, sessionsApi } from '@/classes/api';

// types
import type { ApprovalPolicy, Session } from '@/@types/index';

// -------------------------------------------------- Types --------------------------------------------------

export interface UseApprovalPolicyOptions {
  workspaceId: () => string;
  sessionId: () => string;
  session: Ref<Session | null>;
  toastStore: { error: (message: string) => void };
}

// -------------------------------------------------- Helpers --------------------------------------------------

export function normalizeApprovalPolicy(value: string | null | undefined): ApprovalPolicy {
  return value === 'allow_all' ? 'allow_all' : 'ask';
}

export function useApprovalPolicy(options: UseApprovalPolicyOptions) {
  const { session } = options;

  // -------------------------------------------------- Refs --------------------------------------------------
  const approvalPolicy = ref<ApprovalPolicy>('ask');
  const bSavingApprovalPolicy = ref(false);
  let approvalPolicySaveSeq = 0;

  // -------------------------------------------------- Methods --------------------------------------------------
  /** Takes the policy stored on a fetched or cached session. */
  function applySessionApprovalPolicy(value: string | null | undefined): void {
    approvalPolicy.value = normalizeApprovalPolicy(value);
  }

  async function onApprovalPolicyChange(policy: ApprovalPolicy): Promise<void> {
    if (!session.value || policy === approvalPolicy.value) return;
    const seq = ++approvalPolicySaveSeq;
    const prev = approvalPolicy.value;
    const prevSession = session.value;
    approvalPolicy.value = policy;
    session.value = { ...session.value, approvalPolicy: policy };
    bSavingApprovalPolicy.value = true;
    try {
      const { data: updated } = await sessionsApi.update(
        options.workspaceId(),
        options.sessionId(),
        { approvalPolicy: policy }
      );
      if (seq !== approvalPolicySaveSeq) return;
      session.value = updated;
      approvalPolicy.value = normalizeApprovalPolicy(updated.approvalPolicy);
    } catch (err) {
      if (seq !== approvalPolicySaveSeq) return;
      approvalPolicy.value = prev;
      session.value = prevSession;
      if (!isGloballyToasted(err)) options.toastStore.error('Failed to update approval policy');
    } finally {
      if (seq === approvalPolicySaveSeq) bSavingApprovalPolicy.value = false;
    }
  }

  return {
    // data
    approvalPolicy,
    bSavingApprovalPolicy,
    // methods
    applySessionApprovalPolicy,
    onApprovalPolicyChange
  };
}

export type UseApprovalPolicy = ReturnType<typeof useApprovalPolicy>;
