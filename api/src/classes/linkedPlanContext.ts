// classes
import { getPlanDocumentById } from './planDocuments';

export const LINKED_PLAN_CONTEXT_CONFIG_KEY = '__novaLinkedPlanContext';

export type LinkedPlanContextMode = 'target-only' | 'full';

export interface LinkedPlanContext {
  sourceSessionId: string;
  sourceAcpSessionId: string;
  planId: string;
  planTitle: string;
  entryIndex: number;
  entryContent: string;
  contextMode: LinkedPlanContextMode;
}

export function parseLinkedPlanContext(value: unknown): LinkedPlanContext | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Partial<LinkedPlanContext>;
    if (
      typeof parsed.sourceSessionId !== 'string' ||
      typeof parsed.sourceAcpSessionId !== 'string' ||
      typeof parsed.planId !== 'string' ||
      typeof parsed.planTitle !== 'string' ||
      typeof parsed.entryContent !== 'string' ||
      typeof parsed.entryIndex !== 'number'
    ) {
      return null;
    }
    return {
      sourceSessionId: parsed.sourceSessionId,
      sourceAcpSessionId: parsed.sourceAcpSessionId,
      planId: parsed.planId,
      planTitle: parsed.planTitle,
      entryIndex: parsed.entryIndex,
      entryContent: parsed.entryContent,
      contextMode: parsed.contextMode === 'full' ? 'full' : 'target-only',
    };
  } catch {
    return null;
  }
}

export function serializeLinkedPlanContext(context: LinkedPlanContext): string {
  return JSON.stringify({
    sourceSessionId: context.sourceSessionId,
    sourceAcpSessionId: context.sourceAcpSessionId,
    planId: context.planId,
    planTitle: context.planTitle,
    entryIndex: context.entryIndex,
    entryContent: context.entryContent,
    contextMode: context.contextMode,
  });
}

export function extractLinkedPlanContextFromConfig(
  configJson: string | null | undefined
): { linkedPlanContext: LinkedPlanContext | null; agentConfig: Record<string, string> } {
  if (!configJson) {
    return { linkedPlanContext: null, agentConfig: {} };
  }

  try {
    const parsed = JSON.parse(configJson) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { linkedPlanContext: null, agentConfig: {} };
    }
    const obj = parsed as Record<string, unknown>;
    const linkedPlanContext = parseLinkedPlanContext(obj[LINKED_PLAN_CONTEXT_CONFIG_KEY]);
    const agentConfig = Object.fromEntries(
      Object.entries(obj).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && !entry[0].startsWith('__nova')
      )
    );
    return { linkedPlanContext, agentConfig };
  } catch {
    return { linkedPlanContext: null, agentConfig: {} };
  }
}

export function mergeInternalSessionConfig(
  existingConfigJson: string | null | undefined,
  nextAgentConfig: Record<string, string> | null | undefined
): string | null {
  const next: Record<string, string> = nextAgentConfig ? { ...nextAgentConfig } : {};
  try {
    const existing = existingConfigJson ? JSON.parse(existingConfigJson) as unknown : null;
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      for (const [key, value] of Object.entries(existing as Record<string, unknown>)) {
        if (key.startsWith('__nova') && typeof value === 'string' && next[key] === undefined) {
          next[key] = value;
        }
      }
    }
  } catch {
    // Ignore malformed previous config and save only the new agent-facing config.
  }
  return Object.keys(next).length > 0 ? JSON.stringify(next) : null;
}

export async function buildLinkedPlanContextPrefix(
  context: LinkedPlanContext | null
): Promise<string> {
  if (!context) return '';

  const parts = [
    'Linked plan context is attached to this session by Nova Code.',
    `Source plan: ${context.planTitle}`,
    `Target point: ${context.entryIndex + 1}`,
    '',
    '## Target Plan Point',
    '',
    context.entryContent.trim(),
  ];

  if (context.contextMode === 'full') {
    const doc = await getPlanDocumentById(context.planId, { sessionId: context.sourceAcpSessionId });
    if (doc?.markdown.trim()) {
      parts.push('', '## Full Source Plan', '', doc.markdown.trim());
    }
  }

  return parts.join('\n');
}
