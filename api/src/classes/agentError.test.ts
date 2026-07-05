import { describe, expect, it } from 'vitest';

import { classifyAgentError } from './agentError';

describe('classifyAgentError', () => {
  it('classifies explicit auth errors', () => {
    const result = classifyAgentError('Cursor is not authenticated', { agentLabel: 'Cursor' });

    expect(result.code).toBe('auth_required');
    expect(result.message).toContain('not authenticated');
  });

  it('classifies timeout strings', () => {
    const result = classifyAgentError('cursor-agent timed out', { agentLabel: 'Cursor' });

    expect(result.code).toBe('timeout');
    expect(result.message).toContain('did not respond');
  });

  it('lets timeout win when both timeout and auth words appear', () => {
    const result = classifyAgentError('ETIMEDOUT while checking not authenticated status', {
      agentLabel: 'Cursor'
    });

    expect(result.code).toBe('timeout');
  });
});
