/** Max characters for a session title derived from the first user prompt. */
export const MAX_SESSION_NAME_LENGTH = 60;

/**
 * Build a short session title from the first user message.
 * Uses the first non-empty line, strips markdown headings, and truncates
 * on a word boundary when possible. Returns '' when there is no usable text
 * (callers may fall back to "Image" for attachment-only prompts).
 */
export function sessionNameFromFirstMessage(text: string): string {
  const firstLine = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return '';
  }

  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= MAX_SESSION_NAME_LENGTH) {
    return collapsed;
  }

  const sliced = collapsed.slice(0, MAX_SESSION_NAME_LENGTH);
  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace >= 24) {
    return sliced.slice(0, lastSpace).trimEnd();
  }
  return sliced.trimEnd();
}
