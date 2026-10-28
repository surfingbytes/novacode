// @vitest-environment jsdom
// node_modules
import { beforeEach, describe, expect, it, vi } from 'vitest';

// composables
import {
  HIDE_THINKING_LS_KEY,
  HIDE_TOOL_CALLS_LS_KEY,
  useChatViewToggles
} from './useChatViewToggles';

describe('useChatViewToggles', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads the persisted toggles on creation', () => {
    localStorage.setItem(HIDE_THINKING_LS_KEY, '1');
    const toggles = useChatViewToggles();
    expect(toggles.hideThinkingOutput.value).toBe(true);
    expect(toggles.hideToolCalls.value).toBe(false);
  });

  it('persists on and removes the key when switched off', () => {
    const toggles = useChatViewToggles();
    toggles.onHideToolCallsToggle(true);
    expect(localStorage.getItem(HIDE_TOOL_CALLS_LS_KEY)).toBe('1');
    expect(useChatViewToggles().hideToolCalls.value).toBe(true);

    toggles.onHideToolCallsToggle(false);
    expect(toggles.hideToolCalls.value).toBe(false);
    expect(localStorage.getItem(HIDE_TOOL_CALLS_LS_KEY)).toBeNull();
  });

  it('calls onThinkingHidden only when thinking gets hidden', () => {
    const onThinkingHidden = vi.fn();
    const toggles = useChatViewToggles({ onThinkingHidden });
    toggles.onHideThinkingToggle(false);
    expect(onThinkingHidden).not.toHaveBeenCalled();
    toggles.onHideThinkingToggle(true);
    expect(onThinkingHidden).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(HIDE_THINKING_LS_KEY)).toBe('1');
  });

  it('toggles and collapses expanded tool outputs', () => {
    const toggles = useChatViewToggles();
    toggles.toggleToolOutput('a');
    toggles.toggleToolOutput('b');
    toggles.toggleToolOutput('a');
    expect([...toggles.expandedToolOutputIds.value]).toEqual(['b']);
    toggles.collapseAllToolOutputs();
    expect(toggles.expandedToolOutputIds.value.size).toBe(0);
  });
});
