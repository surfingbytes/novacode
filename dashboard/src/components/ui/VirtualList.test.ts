// @vitest-environment jsdom

// node_modules
import { afterEach, describe, it, expect, vi } from 'vitest';
import { h, nextTick } from 'vue';
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

  describe('position-dependent item heights', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('settles instead of looping when the last rendered item is shorter', async () => {
      // `not-last:pb-1` style: every item is 70px except the last rendered one (66px)
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const bItem = this.hasAttribute('data-vl-key');
        const height = bItem ? (this.parentElement?.lastElementChild === this ? 66 : 70) : 0;
        return { height, width: 100, top: 0, bottom: height, left: 0, right: 100, x: 0, y: 0, toJSON: () => ({}) };
      });
      // The window edge lands in the 4px band where the range flips back and forth
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(106);
      const items = Array.from({ length: 200 }, (_, i) => ({ id: `s${i}`, name: `Session ${i}` }));
      const wrapper = mount(VirtualList<{ id: string; name: string }>, {
        props: { items, itemKey: (item: { id: string }) => item.id, estimateSize: 64 } as never,
        slots: { default: ({ item }: { item: { name: string } }) => h('span', item.name) },
        attachTo: document.body
      });
      for (let i = 0; i < 5; i += 1) await nextTick();

      expect(wrapper.findAll('[data-vl-key]').length).toBeGreaterThan(0);
      wrapper.unmount();
    });
  });
});
