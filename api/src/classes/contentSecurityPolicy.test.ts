import { describe, expect, it } from 'vitest';

import { contentSecurityPolicyDirectives } from './contentSecurityPolicy';

describe('contentSecurityPolicyDirectives', () => {
  it('does not allow inline or eval script execution', () => {
    expect(contentSecurityPolicyDirectives.scriptSrc).toEqual(["'self'", 'blob:']);
    expect(contentSecurityPolicyDirectives.scriptSrc).not.toContain("'unsafe-inline'");
    expect(contentSecurityPolicyDirectives.scriptSrc).not.toContain("'unsafe-eval'");
  });
});
