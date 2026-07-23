// node_modules
import { computed, ref, type ComputedRef } from 'vue';

// utils
import type { DisplayItem, TodoDisplayItem } from '@/utils/chatDisplayItems';

/**
 * Derives the agent's current todo list from chat display items (live stream +
 * history) and owns the ChatTodoPanel UI state: tri-state expand cycle
 * (collapsed → preview → full) and the desktop close/reopen toggle, both
 * persisted in localStorage. Mirrors the usePlanDocuments pattern — state is
 * derived, never stored, so it works for live runs and history replays alike.
 */

// -------------------------------------------------- Types --------------------------------------------------

export type TodoPanelState = 'collapsed' | 'preview' | 'full';

interface DisplayChatMessageLike {
  items: DisplayItem[];
}

// -------------------------------------------------- Constants --------------------------------------------------

const PANEL_STATE_LS_KEY = 'nova:chat:todoPanelState';
const PANEL_CLOSED_LS_KEY = 'nova:chat:todoPanelClosed';
const PANEL_STATES: TodoPanelState[] = ['collapsed', 'preview', 'full'];

function readInitialPanelState(): TodoPanelState {
  try {
    const stored = localStorage.getItem(PANEL_STATE_LS_KEY);
    if (stored && (PANEL_STATES as string[]).includes(stored)) {
      return stored as TodoPanelState;
    }
  } catch {
    // ignore quota / private mode
  }
  const bDesktop =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(min-width: 1024px)').matches;
  return bDesktop ? 'full' : 'preview';
}

function readInitialClosed(): boolean {
  try {
    return localStorage.getItem(PANEL_CLOSED_LS_KEY) === '1';
  } catch {
    return false;
  }
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

  function cyclePanelState(): void {
    if (panelState.value === 'preview') {
      panelState.value = 'full';
    } else if (panelState.value === 'full') {
      panelState.value = 'collapsed';
    } else {
      panelState.value = 'preview';
    }
    try {
      localStorage.setItem(PANEL_STATE_LS_KEY, panelState.value);
    } catch {
      // ignore quota / private mode
    }
  }

  function closePanel(): void {
    bPanelClosed.value = true;
    try {
      localStorage.setItem(PANEL_CLOSED_LS_KEY, '1');
    } catch {
      // ignore quota / private mode
    }
  }

  function openPanel(): void {
    bPanelClosed.value = false;
    try {
      localStorage.removeItem(PANEL_CLOSED_LS_KEY);
    } catch {
      // ignore quota / private mode
    }
  }

  return {
    todoItems,
    todoDoneCount,
    bAnyTodos,
    bTodosRunning,
    panelState,
    bPanelClosed,
    cyclePanelState,
    closePanel,
    openPanel
  };
}
