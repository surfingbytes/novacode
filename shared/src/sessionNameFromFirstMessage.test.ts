// node_modules
import { describe, it, expect } from 'vitest';

// classes
import { sessionNameFromFirstMessage } from './sessionNameFromFirstMessage.js';

describe('sessionNameFromFirstMessage', () => {
  it('returns empty string for blank or whitespace-only input', () => {
    expect(sessionNameFromFirstMessage('')).toBe('');
    expect(sessionNameFromFirstMessage('   \n\n  ')).toBe('');
  });

  it('uses the first non-empty line and strips a markdown heading', () => {
    expect(sessionNameFromFirstMessage('# Fix the login bug\n\nMore detail')).toBe(
      'Fix the login bug'
    );
  });

  it('collapses internal whitespace', () => {
    expect(sessionNameFromFirstMessage('  refactor   the   auth  flow  ')).toBe(
      'refactor the auth flow'
    );
  });

  it('truncates long prompts on a word boundary', () => {
    const text =
      'Please rewrite the authentication middleware so that expired tokens are rejected before the handler runs and add coverage';
    const name = sessionNameFromFirstMessage(text);
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name.endsWith(' ')).toBe(false);
    expect(text.startsWith(name)).toBe(true);
  });
});
