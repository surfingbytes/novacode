// node_modules
import { describe, it, expect } from 'vitest';

// utils
import { sessionStatusDotStyle, workspaceColor } from '@/utils/workspaceColor';

describe('workspaceColor', () => {
  it('returns the workspace color when set', () => {
    expect(workspaceColor({ color: '#ff8800' })).toBe('#ff8800');
  });

  it('falls back to the accent token when color is missing or blank', () => {
    expect(workspaceColor({ color: null })).toBe('var(--accent)');
    expect(workspaceColor({ color: '  ' })).toBe('var(--accent)');
    expect(workspaceColor(undefined)).toBe('var(--accent)');
    expect(workspaceColor(null)).toBe('var(--accent)');
  });
});

describe('sessionStatusDotStyle', () => {
  it('busy dot uses the full workspace color with a glow', () => {
    expect(sessionStatusDotStyle({ color: '#ff8800' }, true)).toEqual({
      background: '#ff8800',
      boxShadow: '0 0 0 3px color-mix(in oklab, #ff8800 20%, transparent)'
    });
  });

  it('idle dot uses the dimmed workspace color without a glow', () => {
    expect(sessionStatusDotStyle({ color: '#ff8800' }, false)).toEqual({
      background: 'color-mix(in oklab, #ff8800 35%, transparent)'
    });
  });

  it('falls back to the accent token for colorless workspaces', () => {
    expect(sessionStatusDotStyle(null, true).background).toBe('var(--accent)');
  });
});
