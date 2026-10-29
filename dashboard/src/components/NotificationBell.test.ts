// @vitest-environment jsdom

// node_modules
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// components
import NotificationBell from '@/components/NotificationBell.vue';

// stores
import { useNotificationsStore } from '@/stores/notifications';

const push = vi.fn();

vi.mock('vue-router', () => ({
  useRouter: () => ({ push })
}));

function pushSamples(count: number): void {
  const store = useNotificationsStore();
  for (let index = 0; index < count; index++) {
    store.push({ kind: 'session-finished', title: `Session ${index}`, body: 'Nova', href: `/workspace/ws-1/session/s-${index}` });
  }
}

describe('NotificationBell', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    setActivePinia(createPinia());
    push.mockClear();
  });

  it('shows the unread count and caps it at 99+', async () => {
    const wrapper = mount(NotificationBell, { attachTo: document.getElementById('app')! });
    expect(wrapper.find('[data-testid="notification-badge"]').exists()).toBe(false);

    pushSamples(3);
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-testid="notification-badge"]').text()).toBe('3');
    expect(wrapper.get('button[aria-haspopup="menu"]').attributes('aria-label')).toBe('Notifications, 3 unread');

    useNotificationsStore().reset();
    for (let index = 0; index < 120; index++) {
      useNotificationsStore().items.push({
        id: `n-${index}`,
        kind: 'automation-failed',
        title: 'Nightly',
        body: 'Run failed',
        href: '/automations',
        createdAt: new Date().toISOString(),
        read: false
      });
    }
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-testid="notification-badge"]').text()).toBe('99+');
    wrapper.unmount();
  });

  it('opens without marking read, then "Mark all read" clears the badge', async () => {
    pushSamples(2);
    const wrapper = mount(NotificationBell, { attachTo: document.getElementById('app')! });

    await wrapper.get('button[aria-haspopup="menu"]').trigger('click');
    expect(wrapper.findAll('.notification-bell__item')).toHaveLength(2);
    expect(useNotificationsStore().unreadCount).toBe(2);

    const markAll = wrapper.findAll('button').find((button) => button.text() === 'Mark all read');
    await markAll!.trigger('click');

    expect(useNotificationsStore().unreadCount).toBe(0);
    expect(wrapper.find('[data-testid="notification-badge"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows the empty text and navigates on item click', async () => {
    const wrapper = mount(NotificationBell, { attachTo: document.getElementById('app')! });
    await wrapper.get('button[aria-haspopup="menu"]').trigger('click');
    expect(wrapper.text()).toContain('No notifications yet');

    pushSamples(1);
    await wrapper.vm.$nextTick();
    await wrapper.get('.notification-bell__item').trigger('click');

    expect(push).toHaveBeenCalledWith('/workspace/ws-1/session/s-0');
    expect(useNotificationsStore().unreadCount).toBe(0);
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('closes on Escape', async () => {
    const wrapper = mount(NotificationBell, { attachTo: document.getElementById('app')! });
    await wrapper.get('button[aria-haspopup="menu"]').trigger('click');
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
