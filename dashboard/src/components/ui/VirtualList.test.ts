// @vitest-environment jsdom

// node_modules
import { describe, it, expect } from 'vitest';
import { h } from 'vue';
import { mount } from '@vue/test-utils';

// components
import VirtualList from '@/components/ui/VirtualList.vue';

function mountList(count: number, threshold = 80) {
  const items = Array.from({ length: count }, (_, i) => ({ id: `s${i}`, name: `Session ${i}` }));
  return mount(VirtualList<{ id: string; name: string }>, {
    props: {
      items,
      itemKey: (item: { id: string }) => item.id,
      estimateSize: 50,
      threshold,
      tag: 'ul',
      itemTag: 'li'
    },
    slots: {
      default: ({ item }: { item: { name: string } }) => h('span', { class: 'row' }, item.name)
    }
  });
}

describe('VirtualList', () => {
  it('renders every item below the threshold without padding', () => {
    const wrapper = mountList(10);
    expect(wrapper.findAll('li')).toHaveLength(10);
    expect(wrapper.find('ul').attributes('style')).toBeUndefined();
  });

  it('renders only a window of a large list and pads the rest', () => {
    const wrapper = mountList(500);
    const rows = wrapper.findAll('li');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    expect(rows[0].text()).toBe('Session 0');
    expect(rows[0].attributes('data-vl-key')).toBe('s0');
    const style = wrapper.find('ul').attributes('style') ?? '';
    expect(style).toContain('padding-top: 0px');
    // Unrendered items keep the estimated height so the scrollbar stays correct
    expect(style).toContain(`padding-bottom: ${(500 - rows.length) * 50}px`);
  });
});
