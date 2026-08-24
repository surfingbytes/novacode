import { describe, expect, it } from 'vitest';

import { classifyAgentError, extractAgentErrorDetail } from './agentError';

describe('classifyAgentError', () => {
  it('classifies explicit auth errors', () => {
    const result = classifyAgentError('Cursor is not authenticated', { agentLabel: 'Cursor' });

    expect(result.code).toBe('auth_required');
    expect(result.message).toContain('not authenticated');
  });

  it('classifies auth via ACP RequestError code -32000', () => {
    const result = classifyAgentError('something else', {
      agentLabel: 'Cursor',
      detail: { message: 'Authentication required', rpcCode: -32000 },
    });

    expect(result.code).toBe('auth_required');
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

  it('classifies Cursor resource_exhausted status tokens as rate_limited', () => {
    const result = classifyAgentError('Error: RetriableError: [resource_exhausted] Error', {
      agentLabel: 'Cursor',
    });

    expect(result.code).toBe('rate_limited');
    expect(result.message).toContain('rate-limited');
  });

  it('prefers structured data status over message prose', () => {
    const result = classifyAgentError('Internal error', {
      agentLabel: 'Cursor',
      detail: {
        message: 'Internal error',
        rpcCode: -32603,
        data: { status: 'resource_exhausted' },
      },
    });

    expect(result.code).toBe('rate_limited');
  });

  it('classifies RetriableError name in structured data', () => {
    const result = classifyAgentError('Internal error', {
      agentLabel: 'Cursor',
      detail: {
        message: 'Internal error',
        data: { name: 'RetriableError' },
      },
    });

    expect(result.code).toBe('rate_limited');
  });

  it('does not treat generic Claude usage-limit prose as rate_limited', () => {
    const result = classifyAgentError(
      'You have hit your usage limit. Try again after 2026-08-24.',
      { agentLabel: 'Agent' }
    );

    expect(result.code).toBe('unknown');
  });
});

describe('extractAgentErrorDetail', () => {
  it('keeps RequestError-shaped code and data', () => {
    const err = Object.assign(new Error('RetriableError: [resource_exhausted] Error'), {
      name: 'RequestError',
      code: -32603,
      data: { status: 'resource_exhausted' },
    });

    expect(extractAgentErrorDetail(err)).toEqual({
      message: 'RequestError\nRetriableError: [resource_exhausted] Error',
      rpcCode: -32603,
      data: { status: 'resource_exhausted' },
    });
  });
});
