import { describe, expect, it } from 'vitest';

import {
  buildSpecTemplate,
  buildWriteSpecPrompt,
  extractSpecFromReply,
  isChatNewerThanSpec,
  sanitizePlanSubtasks,
  sessionSpecPath,
  specHasContent
} from './sessionSpec';
import { resolveAdditionalDirectories } from './acpSubprocessRunner';

describe('sessionSpecPath', () => {
  it('builds /config/specs/<workspace>/<session>.md', () => {
    expect(sessionSpecPath('ws-1', 'sess_2')).toBe('/config/specs/ws-1/sess_2.md');
  });

  it('rejects ids that could escape the specs folder', () => {
    expect(() => sessionSpecPath('../etc', 'x')).toThrow();
    expect(() => sessionSpecPath('ws', 'a/b')).toThrow();
  });
});

describe('specHasContent', () => {
  it('treats the generated template as empty', () => {
    expect(specHasContent(buildSpecTemplate('s1', 'My chat'))).toBe(false);
  });

  it('detects real content after the template', () => {
    expect(specHasContent(`${buildSpecTemplate('s1', 'My chat')}\n## Goal\nShip it\n`)).toBe(true);
  });
});

describe('extractSpecFromReply', () => {
  it('returns the text inside the last nova-spec block', () => {
    const reply = 'Here:\n<nova-spec>\nold\n</nova-spec>\nFixed:\n<nova-spec>\n# Spec\n- a\n</nova-spec>\nDone';
    expect(extractSpecFromReply(reply)).toBe('# Spec\n- a');
  });

  it('accepts a missing closing tag', () => {
    expect(extractSpecFromReply('<nova-spec>\n# Spec\n- a')).toBe('# Spec\n- a');
  });

  it('returns null without a block or with an empty one', () => {
    expect(extractSpecFromReply('# Spec without tags')).toBeNull();
    expect(extractSpecFromReply('<nova-spec>\n</nova-spec>')).toBeNull();
  });
});

describe('buildWriteSpecPrompt', () => {
  it('includes existing spec content only when it has more than the template', () => {
    expect(buildWriteSpecPrompt(buildSpecTemplate('s1', 'x'))).not.toContain('<current-spec>');
    expect(buildWriteSpecPrompt('# Spec: x\n\n- keep me')).toContain('- keep me');
  });
});

describe('isChatNewerThanSpec', () => {
  it('ignores small gaps and flags later chat activity', () => {
    expect(isChatNewerThanSpec('2026-10-19T10:00:03.000Z', '2026-10-19T10:00:00.000Z')).toBe(false);
    expect(isChatNewerThanSpec('2026-10-19T10:05:00.000Z', '2026-10-19T10:00:00.000Z')).toBe(true);
    expect(isChatNewerThanSpec(null, '2026-10-19T10:00:00.000Z')).toBe(false);
  });
});

describe('sanitizePlanSubtasks', () => {
  it('drops empty steps, forward dependencies and stale run state', () => {
    const result = sanitizePlanSubtasks([
      { name: 'A', prompt: 'do a', category: null, dependsOn: [1] },
      { name: '', prompt: 'do b', category: 'tests', dependsOn: [0, 1, 5], runResult: 'done', sessionId: 'x' },
      { name: 'C', prompt: '  ', category: null }
    ]);
    expect(result).toEqual([
      { name: 'A', prompt: 'do a', category: null },
      { name: 'Step 2', prompt: 'do b', category: 'tests', dependsOn: [0] }
    ]);
  });
});

describe('resolveAdditionalDirectories', () => {
  const advertised = { agentCapabilities: { sessionCapabilities: { additionalDirectories: {} } } };
  const notAdvertised = { agentCapabilities: { sessionCapabilities: { list: {} } } };

  it('sends dirs only when the agent advertises support', () => {
    expect(resolveAdditionalDirectories({ additionalDirectories: ['/config/specs/w'] }, advertised)).toEqual([
      '/config/specs/w'
    ]);
    expect(resolveAdditionalDirectories({ additionalDirectories: ['/config/specs/w'] }, notAdvertised)).toBeNull();
  });

  it('honours the unadvertised override and skips empty lists', () => {
    expect(
      resolveAdditionalDirectories(
        { additionalDirectories: ['/config/specs/w'], additionalDirectoriesUnadvertised: true },
        notAdvertised
      )
    ).toEqual(['/config/specs/w']);
    expect(resolveAdditionalDirectories({ additionalDirectories: [] }, advertised)).toBeNull();
  });
});
