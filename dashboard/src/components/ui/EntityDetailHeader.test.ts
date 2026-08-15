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

  it('shows Export Markdown in the mobile menu when showExport is set', async () => {
    const onExport = vi.fn();
    const wrapper = mount(EntityDetailHeader, {
      props: { title: 'My session', showExport: true, onExport },
      attachTo: document.getElementById('app')!
    });
    await wrapper.find('button[aria-label="Session actions"]').trigger('click');
    const items = wrapper.findAll('[role="menuitem"]');
    expect(items.map((item) => item.text())).toContain('Export Markdown');
    const exportItem = items.filter((item) => item.text().includes('Export Markdown'))[0];
    expect(exportItem).toBeTruthy();
    await exportItem.trigger('click');
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('renders subtitle-trailing after the workspace name', () => {
    const wrapper = mount(EntityDetailHeader, {
      props: { title: 'My session', subtitle: 'novacode' },
      slots: { 'subtitle-trailing': '<span>$0.0123</span>' }
    });
    expect(wrapper.text()).toContain('novacode');
    expect(wrapper.text()).toContain('$0.0123');
  });

  it('emits selectSubtitle from the workspace switcher', async () => {
    const onSelectSubtitle = vi.fn();
    const wrapper = mount(EntityDetailHeader, {
      props: {
        title: 'My session',
        subtitle: 'novacode',
        currentSubtitleId: 'ws-1',
        subtitleItems: [
          { id: 'ws-1', name: 'novacode' },
          { id: 'ws-2', name: 'home' }
        ],
        onSelectSubtitle
      },
      attachTo: document.getElementById('app')!
    });
    await wrapper.find('button[aria-label="Switch workspace"]').trigger('click');
    const items = wrapper.findAll('[role="menuitem"]');
    expect(items.map((item) => item.text())).toEqual(['novacode', 'home']);
    await items[1].trigger('click');
    expect(onSelectSubtitle).toHaveBeenCalledWith('ws-2');
  });
});
