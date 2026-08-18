/**
 * Chat composer send-key preference. localStorage only — not synced to the
 * server — so laptop and phone can differ.
 */

import { safeGetItem, safeSetItem } from '@/lib/safeLocalStorage';

export const SEND_ON_ENTER_KEY = 'nova:chat:sendOnEnter';

/** Default is Enter-to-send (current composer behavior). */
export function isSendOnEnter(): boolean {
  return safeGetItem(SEND_ON_ENTER_KEY) !== '0';
}

export function setSendOnEnter(enabled: boolean): void {
  safeSetItem(SEND_ON_ENTER_KEY, enabled ? '1' : '0');
}
