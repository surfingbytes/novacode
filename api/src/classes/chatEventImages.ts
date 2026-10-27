/**
 * Strips inline base64 image payloads from agent stream lines.
 *
 * Tool results (e.g. Claude's Read on a JPEG) carry the full image twice —
 * in `content` and in `rawOutput`. The chat UI never renders them, but they
 * bloat every history frame and DB write (one turn reading ~180 images was
 * 168 MB and made the history save time out).
 */

/** Lines shorter than this cannot hold an image worth stripping — skip the parse. */
const MIN_LINE_LENGTH = 4096;
/** Image data strings at or below this length are kept as-is. */
const MAX_KEPT_DATA_LENGTH = 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripImageData(value: unknown): boolean {
  if (Array.isArray(value)) {
    let bChanged = false;
    for (const item of value) {
      if (stripImageData(item)) bChanged = true;
    }
    return bChanged;
  }
  if (!isRecord(value)) {
    return false;
  }
  let bChanged = false;
  if (value.type === 'image') {
    // ACP content block: { type: 'image', data, mimeType }
    if (typeof value.data === 'string' && value.data.length > MAX_KEPT_DATA_LENGTH) {
      value.data = '';
      value.omitted = true;
      bChanged = true;
    }
    // Anthropic block: { type: 'image', source: { type: 'base64', data, media_type } }
    const source = value.source;
    if (isRecord(source) && typeof source.data === 'string' && source.data.length > MAX_KEPT_DATA_LENGTH) {
      source.data = '';
      value.omitted = true;
      bChanged = true;
    }
    // Claude Code tool response (_meta.claudeCode.toolResponse): { type: 'image', file: { base64, type } }
    const file = value.file;
    if (isRecord(file) && typeof file.base64 === 'string' && file.base64.length > MAX_KEPT_DATA_LENGTH) {
      file.base64 = '';
      value.omitted = true;
      bChanged = true;
    }
  }
  for (const child of Object.values(value)) {
    if (stripImageData(child)) bChanged = true;
  }
  return bChanged;
}

/** Returns the line with large inline image data removed (unchanged line when there is none). */
export function stripInlineImagesFromEventLine(line: string): string {
  if (line.length < MIN_LINE_LENGTH || !line.includes('"image"')) {
    return line;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return line;
  }
  return stripImageData(parsed) ? JSON.stringify(parsed) : line;
}
