// node_modules
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// stores
import { MAX_NOTIFICATIONS, useNotificationsStore } from '@/stores/notifications';

function pushSample(title: string): void {
  useNotificationsStore().push({ kind: 'session-finished', title, body: 'Nova', href: '/workspace/ws-1/session/s-1' });
}

describe('notifications store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('pushes unread items newest first', () => {
    pushSample('first');
    pushSample('second');
    const store = useNotificationsStore();

    expect(store.items.map((item) => item.title)).toEqual(['second', 'first']);
    expect(store.items.every((item) => !item.read)).toBe(true);
    expect(new Set(store.items.map((item) => item.id)).size).toBe(2);
    expect(store.unreadCount).toBe(2);
  });

  it('caps the list and drops the oldest', () => {
    for (let index = 0; index < MAX_NOTIFICATIONS + 5; index++) {
      pushSample(`item ${index}`);
    }
    const store = useNotificationsStore();

    expect(store.items).toHaveLength(MAX_NOTIFICATIONS);
    expect(store.items[0].title).toBe(`item ${MAX_NOTIFICATIONS + 4}`);
    expect(store.items.at(-1)?.title).toBe('item 5');
  });

  it('marks one or all items read', () => {
    pushSample('first');
    pushSample('second');
    pushSample('third');
    const store = useNotificationsStore();

    store.markRead(store.items[1].id);
    expect(store.unreadCount).toBe(2);
    expect(store.items[1].read).toBe(true);

    store.markAllRead();
    expect(store.unreadCount).toBe(0);
    expect(store.items).toHaveLength(3);
  });

  it('marks items read by target, leaving other and already-read items alone', () => {
    const store = useNotificationsStore();
    store.push({ kind: 'session-finished', title: 'a', body: '', href: '/x', targetId: 'sess-1' });
    store.push({ kind: 'session-finished', title: 'b', body: '', href: '/y', targetId: 'sess-2' });
    store.push({ kind: 'automation-failed', title: 'c', body: '', href: '/automations' });
    const before = store.items;

    store.markReadForTargets(['nope']);
    expect(store.items).toBe(before);

    store.markReadForTargets(['sess-1', 'sess-2']);
    expect(store.items.map((item) => item.read)).toEqual([false, true, true]);
    expect(store.unreadCount).toBe(1);
  });

  it('clear and reset empty the list', () => {
    pushSample('first');
    const store = useNotificationsStore();

    store.clear();
    expect(store.items).toEqual([]);

    pushSample('second');
    store.reset();
    expect(store.items).toEqual([]);
    expect(store.unreadCount).toBe(0);
  });
});
