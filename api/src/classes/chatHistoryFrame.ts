// node_modules
import { createHash } from 'node:crypto';

// types
import type { ChatMessage, ChatQueueItem, ChatWsServerMessage } from '../@types/index';

/** Content fingerprint of a history page; equal fingerprints mean byte-identical pages. */
function hashHistoryPage(messages: ChatMessage[]): string {
  return createHash('sha256').update(JSON.stringify(messages)).digest('base64url');
}

/**
 * The `history` frame sent when a chat socket opens. A reconnecting client
 * passes the fingerprint of the page it already shows; when the page has not
 * changed the messages are left out so a flaky connection does not download
 * the same (often large) page again.
 */
export function buildHistoryFrame(opts: {
  messages: ChatMessage[];
  hasMore: boolean;
  queue: ChatQueueItem[];
  streaming?: boolean;
  knownHistoryHash?: string;
}): ChatWsServerMessage {
  const historyHash = hashHistoryPage(opts.messages);
  const frame: ChatWsServerMessage = { type: 'history', hasMore: opts.hasMore, queue: opts.queue, historyHash };
  if (opts.streaming) {
    frame.streaming = true;
  }
  if (opts.knownHistoryHash === historyHash) {
    frame.unchanged = true;
  } else {
    frame.messages = opts.messages;
  }
  return frame;
}
