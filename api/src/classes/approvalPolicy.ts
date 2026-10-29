import type { ApprovalPolicy } from '../@types/index';

/** Normalize stored / client values to a known approval policy. */
export function normalizeApprovalPolicy(value: string | null | undefined): ApprovalPolicy {
  return value === 'allow_all' ? 'allow_all' : 'ask';
}
