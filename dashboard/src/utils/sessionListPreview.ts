// classes
import { extractStreamNotificationPreview } from './chatStreamPreviewFromEvents';

// types
import type { ChatMessage } from '@/@types/index';

const PREVIEW_MAX = 240;

function truncatePreview(s: string): string {
  const trimmedPreview = s.replace(/\s+/g, ' ').trim();
  if (trimmedPreview.length <= PREVIEW_MAX) {
    return trimmedPreview;
  }
  return `${trimmedPreview.slice(0, PREVIEW_MAX - 1)}…`;
}

function lastFromMessages(messages: ChatMessage[]): { text: string; role: 'user' | 'assistant' } | null {
  if (!messages.length) {
    return null;
  }
  const last = messages[messages.length - 1];
  if (last.role === 'user') {
    const text = last.content?.trim() ?? '';
    if (last.imagePaths && last.imagePaths.length > 0 && !text) {
      return { text: truncatePreview('Photo'), role: 'user' };
    }
    if (!text) {
      return null;
    }
    return { text: truncatePreview(text), role: 'user' };
  }
  const previewFromEvents = last.events?.length ? extractStreamNotificationPreview(last.events) : '';
  const previewFromContent = last.content?.trim() ?? '';
  const rawPreview = (previewFromEvents || previewFromContent).trim();
  if (!rawPreview) {
    return null;
  }
  return { text: truncatePreview(rawPreview), role: 'assistant' };
}

/** Line shown under the session title (WhatsApp-style). */
export function formatSessionSidebarPreview(
  text: string | null | undefined,
  role: 'user' | 'assistant' | null | undefined
): string {
  if (!text) {
    return '';
  }
  return role === 'user' ? `You: ${text}` : text;
}

export function previewFromMessageJson(json: string | null | undefined): { text: string; role: 'user' | 'assistant' } | null {
  if (!json) {
    return null;
  }
  try {
    const messages = JSON.parse(json) as ChatMessage[];
    if (!Array.isArray(messages)) {
      return null;
    }
    return lastFromMessages(messages);
  } catch {
    return null;
  }
}
