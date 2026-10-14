// node_modules
import { describe, expect, it } from 'vitest';

// classes
import {
  buildLinkedPlanContextPrefix,
  parseLinkedPlanContext,
  serializeLinkedPlanContext,
  type LinkedPlanContext,
} from './linkedPlanContext';

describe('linkedPlanContext', () => {
  const base: LinkedPlanContext = {
    sourceSessionId: 'nova-1',
    sourceAcpSessionId: 'acp-1',
    planId: 'plan-inline',
    planTitle: 'Fix login',
    entryIndex: 2,
    entryContent: 'Wire the submit handler',
    contextMode: 'full',
    sourceAgentType: 'claude',
    planMarkdown: '# Fix login\n\n1. Wire submit\n2. Add tests\n',
  };

  it('round-trips inline planMarkdown for Claude stream plans', () => {
    const raw = serializeLinkedPlanContext(base);
    const parsed = parseLinkedPlanContext(raw);
    expect(parsed).toEqual(base);
  });

  it('injects inline full plan markdown without file lookup', async () => {
    const prefix = await buildLinkedPlanContextPrefix(base);
    expect(prefix).toContain('Linked plan context is attached');
    expect(prefix).toContain('## Target Plan Point');
    expect(prefix).toContain('Wire the submit handler');
    expect(prefix).toContain('## Full Source Plan');
    expect(prefix).toContain('# Fix login');
    expect(prefix).toContain('Add tests');
  });

  it('names the target by hierarchical label when present', async () => {
    const withLabel = { ...base, entryIndex: 12, entryLabel: '5.3' };
    expect(parseLinkedPlanContext(serializeLinkedPlanContext(withLabel))).toEqual(withLabel);
    expect(await buildLinkedPlanContextPrefix(withLabel)).toContain('Target point: 5.3');
    expect(await buildLinkedPlanContextPrefix(base)).toContain('Target point: 3');
  });

  it('still works for target-only without planMarkdown', async () => {
    const prefix = await buildLinkedPlanContextPrefix({
      ...base,
      contextMode: 'target-only',
      planMarkdown: undefined,
    });
    expect(prefix).toContain('Wire the submit handler');
    expect(prefix).not.toContain('## Full Source Plan');
  });
});
