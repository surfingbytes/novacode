// node_modules
import { computed, ref, type ComputedRef } from 'vue';

// constants
import { PANE_LAYOUT_MIN_WIDTH } from '@/constants/layout';

// utils
import type { DisplayItem, TodoDisplayItem } from '@/utils/chatDisplayItems';
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/lib/safeLocalStorage';

/**
 * Derives the agent's current todo list from chat display items (live stream +
 * history) and owns the ChatTodoPanel UI state: bi-state expand toggle
 * (collapsed ↔ full, narrow strip only) and the wide-pane close/reopen toggle,
 * both persisted in localStorage. Mirrors the usePlanDocuments pattern — state
 * is derived, never stored, so it works for live runs and history replays
 * alike.
 */

// -------------------------------------------------- Types --------------------------------------------------

export type TodoPanelState = 'collapsed' | 'full';

interface DisplayChatMessageLike {
  items: DisplayItem[];
}

// -------------------------------------------------- Constants --------------------------------------------------

const PANEL_STATE_LS_KEY = 'nova:chat:todoPanelState';
const PANEL_CLOSED_LS_KEY = 'nova:chat:todoPanelClosed';
const PANEL_STATES: TodoPanelState[] = ['collapsed', 'full'];

function readInitialPanelState(): TodoPanelState {
  const stored = safeGetItem(PANEL_STATE_LS_KEY);
  if (stored && (PANEL_STATES as string[]).includes(stored)) {
    return stored as TodoPanelState;
  }
  const bWidePane =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(`(min-width: ${PANE_LAYOUT_MIN_WIDTH}px)`).matches;
  return bWidePane ? 'full' : 'collapsed';
}

function readInitialClosed(): boolean {
  return safeGetItem(PANEL_CLOSED_LS_KEY) === '1';
}

// -------------------------------------------------- Composable --------------------------------------------------

export function useTodoList(options: {
  displayMessages: ComputedRef<DisplayChatMessageLike[]>;
  streamingDisplayItems: ComputedRef<DisplayItem[]>;
}) {
  // -------------------------------------------------- Refs --------------------------------------------------
  const panelState = ref<TodoPanelState>(readInitialPanelState());
  const bPanelClosed = ref(readInitialClosed());

  // -------------------------------------------------- Computed --------------------------------------------------

  /** Latest todos item wins: the agent rewrites the whole list on each todowrite call. */
  const latestTodosItem = computed<DisplayItem | null>(() => {
    const live = options.streamingDisplayItems.value;
    for (let i = live.length - 1; i >= 0; i--) {
      if (live[i].kind === 'todos' && live[i].todoItems) {
        return live[i];
      }
    }
    const msgs = options.displayMessages.value;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const items = msgs[i].items;
      for (let j = items.length - 1; j >= 0; j--) {
        if (items[j].kind === 'todos' && items[j].todoItems) {
          return items[j];
        }
      }
    }
    return null;
  });

  const todoItems = computed<TodoDisplayItem[]>(() => latestTodosItem.value?.todoItems ?? []);
  const todoDoneCount = computed(
    () => todoItems.value.filter((todo) => todo.status === 'TODO_STATUS_COMPLETED').length
  );
  const bAnyTodos = computed(() => todoItems.value.length > 0);
  const bTodosRunning = computed(() => latestTodosItem.value?.status === 'running');

  // -------------------------------------------------- Methods --------------------------------------------------

  function togglePanelState(): void {
    panelState.value = panelState.value === 'full' ? 'collapsed' : 'full';
    safeSetItem(PANEL_STATE_LS_KEY, panelState.value);
  }

  function closePanel(): void {
    bPanelClosed.value = true;
    safeSetItem(PANEL_CLOSED_LS_KEY, '1');
  }

  function openPanel(): void {
    bPanelClosed.value = false;
    safeRemoveItem(PANEL_CLOSED_LS_KEY);
  }

  return {
    todoItems,
    todoDoneCount,
    bAnyTodos,
    bTodosRunning,
    panelState,
    bPanelClosed,
    togglePanelState,
    closePanel,
    openPanel
  };
}
