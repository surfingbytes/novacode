// types
import type { ChatMessage } from '../@types/index';

import { extractStreamNotificationPreview } from './chatStreamPreviewFromEvents';

// ---------------------------------- Constants ----------------------------------
const PREVIEW_MAX_LEN = 240;

// ---------------------------------- Methods ----------------------------------
function truncatePreview(inputText: string): string {
  const normalizedText = inputText.replace(/\s+/g, ' ').trim();
  if (normalizedText.length <= PREVIEW_MAX_LEN) {
    return normalizedText;
  }
  return `${normalizedText.slice(0, PREVIEW_MAX_LEN - 1)}…`;
}

/** Last chat line for sidebar / list APIs (user vs assistant). */
export function computeLastListPreview(
  messages: ChatMessage[]
): { lastPreviewText: string; lastPreviewRole: 'user' | 'assistant' } | null {
  if (!messages.length) {
    return null;
  }
  const last = messages[messages.length - 1];
  if (last.role === 'user') {
    const text = last.content?.trim() ?? '';
    if (last.imagePaths && last.imagePaths.length > 0 && !text) {
      return { lastPreviewText: truncatePreview('Photo'), lastPreviewRole: 'user' };
    }
    if (!text) {
      return null;
    }
    return { lastPreviewText: truncatePreview(text), lastPreviewRole: 'user' };
  }
  const fromEvents = last.events?.length ? extractStreamNotificationPreview(last.events) : '';
  const fromContent = last.content?.trim() ?? '';
  const raw = (fromEvents || fromContent).trim();
  if (!raw) {
    return null;
  }
  return { lastPreviewText: truncatePreview(raw), lastPreviewRole: 'assistant' };
}
