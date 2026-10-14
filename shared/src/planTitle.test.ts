import { describe, expect, it } from 'vitest';
import { resolvePlanDisplayTitle } from './planTitle.js';

describe('resolvePlanDisplayTitle', () => {
  it('keeps a real title', () => {
    expect(resolvePlanDisplayTitle('Ship login fix', '# Other\n')).toBe('Ship login fix');
  });

  it('replaces Approve Plan with the markdown heading', () => {
    expect(resolvePlanDisplayTitle('Approve Plan', '# Ship it\n\n1. Build')).toBe('Ship it');
  });

  it('replaces Exited Plan Mode with the markdown heading', () => {
    expect(resolvePlanDisplayTitle('Exited Plan Mode', '## Deploy\n\nSteps')).toBe('Deploy');
  });

  it('returns undefined when only a generic title is present', () => {
    expect(resolvePlanDisplayTitle('Approve Plan', 'no heading here')).toBeUndefined();
  });
});
