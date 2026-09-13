import { describe, expect, it } from 'vitest';

import { DEFAULT_WORKSPACE_BROWSE_ROOT } from '@novacode/shared';

import { parseAbsPrefixRewrite } from './workspacePathMigration';

describe('parseAbsPrefixRewrite', () => {
  it('parses oldPrefix:newPrefix', () => {
    const oldPrefix = `${DEFAULT_WORKSPACE_BROWSE_ROOT}/opt`;
    expect(parseAbsPrefixRewrite(`${oldPrefix}:/opt`)).toEqual({
      oldPrefix,
      newPrefix: '/opt'
    });
  });

  it('returns null for empty or identical prefixes', () => {
    expect(parseAbsPrefixRewrite('')).toBeNull();
    expect(parseAbsPrefixRewrite('/opt:/opt')).toBeNull();
    expect(parseAbsPrefixRewrite('not-a-rewrite')).toBeNull();
  });
});
