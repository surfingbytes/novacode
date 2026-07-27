// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';

// components
import EntityDetailHeader from '@/components/ui/EntityDetailHeader.vue';

async function flushTransitions(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250));
}

describe('EntityDetailHeader', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });

  async function openMobileMenu(showNewSession: boolean, onNewSession = vi.fn()) {
    const wrapper = mount(EntityDetailHeader, {
      props: { title: 'My session', showNewSession, onNewSession },
      attachTo: document.getElementById('app')!
    });
    await wrapper.find('button[aria-label="Session actions"]').trigger('click');
    return { wrapper, onNewSession };
  }

  it('shows "New session" first in the mobile menu and emits newSession on click', async () => {
    const { wrapper, onNewSession } = await openMobileMenu(true);

    const items = wrapper.findAll('[role="menuitem"]');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].text()).toContain('New session');

    await items[0].trigger('click');
    expect(onNewSession).toHaveBeenCalledTimes(1);
    await flushTransitions();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('omits "New session" when showNewSession is not set', async () => {
    const { wrapper } = await openMobileMenu(false);

    const items = wrapper.findAll('[role="menuitem"]');
    expect(items.map((item) => item.text())).toEqual(['Edit', 'Archive', 'Delete']);
  });
});
