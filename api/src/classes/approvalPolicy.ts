import type { ApprovalPolicy } from '../@types/index';

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = 'ask';

/** Normalize stored / client values to a known approval policy. */
export function normalizeApprovalPolicy(value: string | null | undefined): ApprovalPolicy {
  return value === 'allow_all' ? 'allow_all' : 'ask';
}
