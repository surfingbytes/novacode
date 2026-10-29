/**
 * Chat view toggles — hide thinking output / hide tool calls (persisted in localStorage)
 * and which tool outputs are expanded.
 * Extracted from SessionChat.vue.
 */

// node_modules
import { ref } from 'vue';

// classes
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/lib/safeLocalStorage';

// -------------------------------------------------- Constants --------------------------------------------------

export const HIDE_THINKING_LS_KEY = 'nova:chat:hideThinkingOutput';
export const HIDE_TOOL_CALLS_LS_KEY = 'nova:chat:hideToolCalls';

// -------------------------------------------------- Types --------------------------------------------------

export interface UseChatViewTogglesOptions {
  /** Called when thinking output gets hidden (e.g. to clear the live thinking text). */
  onThinkingHidden?: () => void;
}

// -------------------------------------------------- Helpers --------------------------------------------------

function readHideThinkingFromLs(): boolean {
  return safeGetItem(HIDE_THINKING_LS_KEY) === '1';
}

function readHideToolCallsFromLs(): boolean {
  return safeGetItem(HIDE_TOOL_CALLS_LS_KEY) === '1';
}

function persistChatToggle(key: string, checked: boolean): void {
  if (checked) safeSetItem(key, '1');
  else safeRemoveItem(key);
}

export function useChatViewToggles(options: UseChatViewTogglesOptions = {}) {
  // -------------------------------------------------- Refs --------------------------------------------------
  const hideThinkingOutput = ref(readHideThinkingFromLs());
  const hideToolCalls = ref(readHideToolCallsFromLs());
  const expandedToolOutputIds = ref(new Set<string>());

  // -------------------------------------------------- Methods --------------------------------------------------
  function onHideThinkingToggle(checked: boolean): void {
    hideThinkingOutput.value = checked;
    if (checked) options.onThinkingHidden?.();
    persistChatToggle(HIDE_THINKING_LS_KEY, checked);
  }

  function onHideToolCallsToggle(checked: boolean): void {
    hideToolCalls.value = checked;
    persistChatToggle(HIDE_TOOL_CALLS_LS_KEY, checked);
  }

  function toggleToolOutput(callId: string): void {
    const next = new Set(expandedToolOutputIds.value);
    if (next.has(callId)) next.delete(callId);
    else next.add(callId);
    expandedToolOutputIds.value = next;
  }

  function collapseAllToolOutputs(): void {
    expandedToolOutputIds.value = new Set();
  }

  return {
    // data
    hideThinkingOutput,
    hideToolCalls,
    expandedToolOutputIds,
    // methods
    onHideThinkingToggle,
    onHideToolCallsToggle,
    toggleToolOutput,
    collapseAllToolOutputs
  };
}
