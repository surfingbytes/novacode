// @vitest-environment jsdom
// node_modules
import { describe, expect, it } from 'vitest';

// composables
import { tabFromQuery } from './useSessionTabs';

describe('tabFromQuery', () => {
  it('accepts known tabs and rejects anything else', () => {
    for (const tab of ['chat', 'terminal', 'files', 'git', 'plan', 'orchestrator']) {
      expect(tabFromQuery(tab)).toBe(tab);
    }
    expect(tabFromQuery('settings')).toBeNull();
    expect(tabFromQuery(['chat'])).toBeNull();
    expect(tabFromQuery(undefined)).toBeNull();
  });
});
