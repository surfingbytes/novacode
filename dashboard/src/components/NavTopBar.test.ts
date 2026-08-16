// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// components
import NavTopBar from '@/components/NavTopBar.vue';

describe('NavTopBar search', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    setActivePinia(createPinia());
  });

  it('emits searchClick when the search box is clicked', async () => {
    const onSearchClick = vi.fn();
    const wrapper = mount(NavTopBar, {
      props: { sidebarOpen: false, onSearchClick },
      attachTo: document.getElementById('app')!
    });

    await wrapper.get('button[aria-label="Search"]').trigger('click');

    expect(onSearchClick).toHaveBeenCalledTimes(1);
  });
});
