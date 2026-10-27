// types
import type { SessionHandoffSource } from '../@types/index';

/** Stored on the new chat: source chat + handoff summary, injected on its first prompt. */
export const HANDOFF_CONTEXT_CONFIG_KEY = '__novaHandoffContext';
/** Stored on the source chat: id of the chat that continues it. */
export const HANDOFF_TARGET_CONFIG_KEY = '__novaContinuedIn';

/** Sent to the source chat so its agent writes the summary from its own context. */
export const HANDOFF_SUMMARY_PROMPT = [
  'The user is continuing this work in a new chat with a fresh context. Write the handoff note',
  'the new chat will start from. Do not run tools, do not change files, just answer.',
  '',
  'Include only what is needed to continue correctly, not a recap of the whole conversation:',
  '- Goal: what the user is trying to achieve overall.',
  '- Decisions and constraints: what was agreed or ruled out, and why when it matters.',
  '- Current state: what is done, what is in progress; relevant files with short notes.',
  '- Open items: what remains, in order.',
  '- Gotchas: non-obvious findings, failed approaches and pitfalls, so they are not repeated.',
  '',
  'Leave out resolved tangents, full tool output and anything the new chat can read from',
  'the repository itself. Be dense and specific (paths, names, commands).',
  'Reply with the handoff note only, no preamble.',
].join('\n');

export function parseHandoffContext(value: unknown): SessionHandoffSource | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SessionHandoffSource>;
    if (
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.summary !== 'string' ||
      !parsed.summary.trim()
    ) {
      return null;
    }
    return {
      sessionId: parsed.sessionId,
      sessionName: typeof parsed.sessionName === 'string' ? parsed.sessionName : '',
      summary: parsed.summary,
    };
  } catch {
    return null;
  }
}

export function serializeHandoffContext(context: SessionHandoffSource): string {
  return JSON.stringify({
    sessionId: context.sessionId,
    sessionName: context.sessionName,
    summary: context.summary,
  });
}

/** Handoff links read from a raw sessionConfigJson. */
export function extractHandoffLinksFromConfig(configJson: string | null | undefined): {
  continuedFrom: SessionHandoffSource | null;
  continuedInSessionId: string | null;
} {
  const empty = { continuedFrom: null, continuedInSessionId: null };
  if (!configJson) return empty;
  try {
    const parsed = JSON.parse(configJson) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
    const obj = parsed as Record<string, unknown>;
    const target = obj[HANDOFF_TARGET_CONFIG_KEY];
    return {
      continuedFrom: parseHandoffContext(obj[HANDOFF_CONTEXT_CONFIG_KEY]),
      continuedInSessionId: typeof target === 'string' && target ? target : null,
    };
  } catch {
    return empty;
  }
}

/** Raw sessionConfigJson with one internal key set, other keys kept. */
export function setInternalConfigValue(
  configJson: string | null | undefined,
  key: string,
  value: string
): string {
  let obj: Record<string, unknown> = {};
  try {
    const parsed = configJson ? JSON.parse(configJson) as unknown : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      obj = parsed as Record<string, unknown>;
    }
  } catch {
    // malformed config: start over with just this key
  }
  return JSON.stringify({ ...obj, [key]: value });
}

export function buildHandoffContextPrefix(context: SessionHandoffSource | null): string {
  if (!context) return '';
  return [
    'This chat continues an earlier chat. Nova Code attached the handoff note that chat wrote.',
    `Previous chat: ${context.sessionName.trim() || 'Untitled session'}`,
    '',
    '## Handoff Note',
    '',
    context.summary.trim(),
  ].join('\n');
}
