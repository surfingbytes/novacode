// node_modules
import { describe, expect, it } from 'vitest';

// classes
import { mergeInternalSessionConfig } from './linkedPlanContext';
import { normalizeSessionForApi } from './sessionNormalize';
import {
  HANDOFF_CONTEXT_CONFIG_KEY,
  HANDOFF_TARGET_CONFIG_KEY,
  buildHandoffContextPrefix,
  extractHandoffLinksFromConfig,
  parseHandoffContext,
  serializeHandoffContext,
  setInternalConfigValue,
} from './sessionHandoff';

describe('sessionHandoff', () => {
  const context = { sessionId: 'nova-1', sessionName: 'Fix login', summary: 'Goal: wire submit.' };

  it('round-trips the handoff context', () => {
    expect(parseHandoffContext(serializeHandoffContext(context))).toEqual(context);
  });

  it('rejects a context without a summary', () => {
    expect(parseHandoffContext(JSON.stringify({ ...context, summary: '  ' }))).toBeNull();
    expect(parseHandoffContext('not json')).toBeNull();
  });

  it('builds the first-prompt prefix with the note', () => {
    const prefix = buildHandoffContextPrefix(context);
    expect(prefix).toContain('Previous chat: Fix login');
    expect(prefix).toContain('## Handoff Note');
    expect(prefix).toContain('Goal: wire submit.');
    expect(buildHandoffContextPrefix(null)).toBe('');
  });

  it('sets the continued-in link without dropping agent config', () => {
    const raw = setInternalConfigValue('{"reasoning":"high"}', HANDOFF_TARGET_CONFIG_KEY, 'nova-2');
    expect(JSON.parse(raw)).toEqual({ reasoning: 'high', [HANDOFF_TARGET_CONFIG_KEY]: 'nova-2' });
    expect(extractHandoffLinksFromConfig(raw).continuedInSessionId).toBe('nova-2');
  });

  it('keeps handoff links when agent config is merged in', () => {
    const raw = JSON.stringify({ [HANDOFF_CONTEXT_CONFIG_KEY]: serializeHandoffContext(context) });
    const merged = mergeInternalSessionConfig(raw, { reasoning: 'low' });
    expect(extractHandoffLinksFromConfig(merged).continuedFrom).toEqual(context);
  });

  it('exposes links on the API session but not in sessionConfigJson', () => {
    const normalized = normalizeSessionForApi({
      tags: null,
      lastUsageJson: null,
      sessionConfigJson: JSON.stringify({
        reasoning: 'high',
        [HANDOFF_CONTEXT_CONFIG_KEY]: serializeHandoffContext(context),
        [HANDOFF_TARGET_CONFIG_KEY]: 'nova-3',
      }),
    });
    expect(normalized.sessionConfigJson).toEqual({ reasoning: 'high' });
    expect(normalized.continuedFrom).toEqual(context);
    expect(normalized.continuedInSessionId).toBe('nova-3');
  });
});
