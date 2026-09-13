import { describe, expect, it } from 'vitest';

import { parseAbsPrefixRewrite } from './workspacePathMigration';

describe('parseAbsPrefixRewrite', () => {
  it('parses oldPrefix:newPrefix', () => {
    expect(parseAbsPrefixRewrite('/data-root/opt:/opt')).toEqual({
      oldPrefix: '/data-root/opt',
      newPrefix: '/opt'
    });
  });

  it('returns null for empty or identical prefixes', () => {
    expect(parseAbsPrefixRewrite('')).toBeNull();
    expect(parseAbsPrefixRewrite('/opt:/opt')).toBeNull();
    expect(parseAbsPrefixRewrite('not-a-rewrite')).toBeNull();
  });
});
