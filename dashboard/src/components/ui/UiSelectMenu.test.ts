// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';

// components
import UiSelectMenu from '@/components/ui/UiSelectMenu.vue';

async function flushTransitions(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'gpt-5', label: 'GPT 5.5' },
  { value: 'opus', label: 'Opus 4.8' }
];

describe('UiSelectMenu', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });

  it('shows the current value and selects an option', async () => {
    const onUpdate = vi.fn();
    const wrapper = mount(UiSelectMenu, {
      props: { modelValue: 'gpt-5', options: OPTIONS, 'onUpdate:modelValue': onUpdate },
      attachTo: document.getElementById('app')!
    });

    const trigger = wrapper.find('.select-menu-trigger');
    expect(trigger.text()).toContain('GPT 5.5');

    await trigger.trigger('click');
    expect(wrapper.find('.select-menu-panel').exists()).toBe(true);
    expect(wrapper.findAll('.select-menu-option')).toHaveLength(3);

    await wrapper.findAll('.select-menu-option')[2].trigger('click');
    expect(onUpdate).toHaveBeenCalledWith('opus');
    await flushTransitions();
    expect(wrapper.find('.select-menu-panel').exists()).toBe(false);
  });

  it('closes on Escape and does not open when disabled', async () => {
    const wrapper = mount(UiSelectMenu, {
      props: { modelValue: 'auto', options: OPTIONS },
      attachTo: document.getElementById('app')!
    });
    await wrapper.find('.select-menu-trigger').trigger('click');
    expect(wrapper.find('.select-menu-panel').exists()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushTransitions();
    expect(wrapper.find('.select-menu-panel').exists()).toBe(false);

    await wrapper.setProps({ disabled: true });
    await wrapper.find('.select-menu-trigger').trigger('click');
    expect(wrapper.find('.select-menu-panel').exists()).toBe(false);
  });

  it('emits special instead of update for special options and stays open', async () => {
    const onUpdate = vi.fn();
    const onSpecial = vi.fn();
    const wrapper = mount(UiSelectMenu, {
      props: {
        modelValue: 'auto',
        options: [...OPTIONS, { value: '__more__', label: 'More…', hint: 'special' }],
        'onUpdate:modelValue': onUpdate,
        onSpecial
      },
      attachTo: document.getElementById('app')!
    });
    await wrapper.find('.select-menu-trigger').trigger('click');
    const options = wrapper.findAll('.select-menu-option');
    await options[options.length - 1].trigger('click');
    expect(onSpecial).toHaveBeenCalledWith('__more__');
    expect(onUpdate).not.toHaveBeenCalled();
    expect(wrapper.find('.select-menu-panel').exists()).toBe(true);
  });

  it('navigates options with arrow keys and selects with Enter', async () => {
    const onUpdate = vi.fn();
    const wrapper = mount(UiSelectMenu, {
      props: { modelValue: 'auto', options: OPTIONS, 'onUpdate:modelValue': onUpdate },
      attachTo: document.getElementById('app')!
    });
    await wrapper.find('.select-menu-trigger').trigger('click');
    await wrapper.find('.select-menu-trigger').trigger('keydown', { key: 'ArrowDown' });
    await wrapper.find('.select-menu-trigger').trigger('keydown', { key: 'Enter' });
    expect(onUpdate).toHaveBeenCalledWith('gpt-5');
  });
});
