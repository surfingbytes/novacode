// @vitest-environment jsdom

// node_modules
import { describe, it, expect } from 'vitest';

// composables
import { paneDetailVisible, paneListVisible } from '@/composables/usePaneLayout';

describe('paneListVisible', () => {
  it('always shows the list when nothing is selected', () => {
    expect(paneListVisible(true, false, false)).toBe(true);
    expect(paneListVisible(false, false, false)).toBe(true);
  });

  it('hides the list on wide only when the side panel is collapsed', () => {
    expect(paneListVisible(true, false, true)).toBe(false);
    expect(paneListVisible(true, true, true)).toBe(true);
  });

  it('hides the list on narrow when something is selected', () => {
    expect(paneListVisible(false, true, true)).toBe(false);
  });
});

describe('paneDetailVisible', () => {
  it('always shows detail on wide', () => {
    expect(paneDetailVisible(true, false)).toBe(true);
    expect(paneDetailVisible(true, true)).toBe(true);
  });

  it('shows detail on narrow only with a selection', () => {
    expect(paneDetailVisible(false, false)).toBe(false);
    expect(paneDetailVisible(false, true)).toBe(true);
  });
});
