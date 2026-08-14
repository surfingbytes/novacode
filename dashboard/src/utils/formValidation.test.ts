// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  optionalEmailError,
  passwordLengthError,
  requiredTrimmed,
  workspacePathError
} from '@/utils/formValidation';

describe('requiredTrimmed', () => {
  it('rejects blank and whitespace', () => {
    expect(requiredTrimmed('', 'Name')).toBe('Name is required');
    expect(requiredTrimmed('   ', 'Name')).toBe('Name is required');
  });

  it('accepts a non-empty value', () => {
    expect(requiredTrimmed('Acme', 'Name')).toBeUndefined();
  });
});

describe('workspacePathError', () => {
  it('requires a path', () => {
    expect(workspacePathError('')).toBe('Path is required');
  });

  it('accepts a relative project path', () => {
    expect(workspacePathError('projects/my-repo')).toBeUndefined();
    expect(workspacePathError('/projects/my-repo')).toBeUndefined();
  });

  it('rejects walking above /data-root', () => {
    expect(workspacePathError('../secret')).toBe('Path must stay inside /data-root');
    expect(workspacePathError('ok/../../outside')).toBe('Path must stay inside /data-root');
  });

  it('allows .. that stays inside the root', () => {
    expect(workspacePathError('a/b/../c')).toBeUndefined();
  });
});

describe('optionalEmailError', () => {
  it('allows blank', () => {
    expect(optionalEmailError('')).toBeUndefined();
    expect(optionalEmailError('  ')).toBeUndefined();
  });

  it('rejects a malformed address', () => {
    expect(optionalEmailError('not-an-email')).toBe('Enter a valid email address');
  });

  it('accepts a normal address', () => {
    expect(optionalEmailError('you@example.com')).toBeUndefined();
  });
});

describe('passwordLengthError', () => {
  it('allows empty (required is a separate check)', () => {
    expect(passwordLengthError('')).toBeUndefined();
  });

  it('rejects short passwords', () => {
    expect(passwordLengthError('short')).toBe('Password must be at least 8 characters');
  });
});
