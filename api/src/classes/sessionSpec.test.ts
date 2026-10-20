import { describe, expect, it } from 'vitest';

import {
  buildSpecTemplate,
  isChatNewerThanSpec,
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

describe('isChatNewerThanSpec', () => {
  it('ignores small gaps and flags later chat activity', () => {
    expect(isChatNewerThanSpec('2026-10-19T10:00:03.000Z', '2026-10-19T10:00:00.000Z')).toBe(false);
    expect(isChatNewerThanSpec('2026-10-19T10:05:00.000Z', '2026-10-19T10:00:00.000Z')).toBe(true);
    expect(isChatNewerThanSpec(null, '2026-10-19T10:00:00.000Z')).toBe(false);
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
