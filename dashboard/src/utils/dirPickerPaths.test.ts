// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  toApiBrowsePath,
  toDisplayBrowsePath,
  toWorkspacePathFromDisplay
} from '@/utils/dirPickerPaths';

describe('toApiBrowsePath', () => {
  it('maps root UI paths to empty (server default root)', () => {
    expect(toApiBrowsePath('', '/opt')).toBe('');
    expect(toApiBrowsePath('/', '/opt')).toBe('');
    expect(toApiBrowsePath('.', '/opt')).toBe('');
  });

  it('strips browse-root prefix from absolute paths', () => {
    expect(toApiBrowsePath('/opt/src', '/opt')).toBe('src');
    expect(toApiBrowsePath('/opt', '/opt')).toBe('');
  });

  it('keeps relative UI paths relative without inventing an absolute root', () => {
    expect(toApiBrowsePath('/src', '/opt')).toBe('src');
    expect(toApiBrowsePath('src/github', '/opt')).toBe('src/github');
    expect(toApiBrowsePath('/src', '')).toBe('src');
    expect(toApiBrowsePath('src', '')).toBe('src');
  });

  it('does not invent a browse root when none is known yet', () => {
    expect(toApiBrowsePath('/', '')).toBe('');
    expect(toApiBrowsePath('/opt/src', '')).toBe('opt/src');
  });
});

describe('toDisplayBrowsePath', () => {
  it('shows browse root as /', () => {
    expect(toDisplayBrowsePath('/opt', '/opt')).toBe('/');
  });

  it('relativizes absolute paths under the root', () => {
    expect(toDisplayBrowsePath('/opt/src', '/opt')).toBe('/src');
    expect(toDisplayBrowsePath('/opt/src/github', '/opt')).toBe('/src/github');
  });

  it('passes through relative paths', () => {
    expect(toDisplayBrowsePath('src', '/opt')).toBe('/src');
    expect(toDisplayBrowsePath('/src', '/opt')).toBe('/src');
  });
});

describe('toWorkspacePathFromDisplay', () => {
  it('stores browse root as .', () => {
    expect(toWorkspacePathFromDisplay('/')).toBe('.');
    expect(toWorkspacePathFromDisplay('')).toBe('.');
  });

  it('stores nested folders without a leading slash', () => {
    expect(toWorkspacePathFromDisplay('/src/github')).toBe('src/github');
    expect(toWorkspacePathFromDisplay('src/github')).toBe('src/github');
  });
});
