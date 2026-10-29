// node_modules
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export type AppNotificationKind =
  | 'session-finished'
  | 'orchestrator-finished'
  | 'orchestrator-failed'
  | 'orchestrator-needs-input'
  | 'automation-failed';

export interface AppNotification {
  id: string;
  kind: AppNotificationKind;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  read: boolean;
}

export type AppNotificationInput = Pick<AppNotification, 'kind' | 'title' | 'body' | 'href'> &
  Partial<Pick<AppNotification, 'createdAt'>>;

export const MAX_NOTIFICATIONS = 50;

/**
 * In-app notification bell. Fed by live sessions-socket events while the tab
 * is open (see workspaces store); in-memory only, cleared on logout.
 */
export const useNotificationsStore = defineStore('notifications', () => {
  // -------------------------------------------------- Refs --------------------------------------------------
  /** Newest first. */
  const items = ref<AppNotification[]>([]);
  let nextId = 0;

  // -------------------------------------------------- Computed --------------------------------------------------
  const unreadCount = computed<number>(() => items.value.filter((item) => !item.read).length);

  // -------------------------------------------------- Methods --------------------------------------------------
  function push(input: AppNotificationInput): AppNotification {
    nextId += 1;
    const notification: AppNotification = {
      id: `notification-${Date.now()}-${nextId}`,
      kind: input.kind,
      title: input.title,
      body: input.body,
      href: input.href,
      createdAt: input.createdAt ?? new Date().toISOString(),
      read: false
    };
    items.value = [notification, ...items.value].slice(0, MAX_NOTIFICATIONS);
    return notification;
  }

  function markRead(id: string): void {
    items.value = items.value.map((item) => (item.id === id && !item.read ? { ...item, read: true } : item));
  }

  function markAllRead(): void {
    items.value = items.value.map((item) => (item.read ? item : { ...item, read: true }));
  }

  function clear(): void {
    items.value = [];
  }

  /** Logout: drop the previous user's notifications. */
  function reset(): void {
    items.value = [];
    nextId = 0;
  }

  // -------------------------------------------------- Export --------------------------------------------------
  return {
    // data
    items,
    unreadCount,
    // methods
    push,
    markRead,
    markAllRead,
    clear,
    reset
  };
});
