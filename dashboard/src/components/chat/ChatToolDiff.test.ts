// @vitest-environment jsdom

// node_modules
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

// components
import ChatToolDiff from '@/components/chat/ChatToolDiff.vue';

// types
import type { ToolDiff } from '@/utils/chatDisplayTypes';

// -------------------------------------------------- Helpers --------------------------------------------------

function numberedLines(count: number, prefix = 'line'): string {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}\n`).join('');
}

function mountDiff(diffs: ToolDiff[], onToggle = vi.fn()) {
  return mount(ChatToolDiff, { props: { diffs, bExpanded: false, onToggle } });
}

// -------------------------------------------------- Tests --------------------------------------------------

describe('ChatToolDiff', () => {
  it('shows the path and added/removed counts per file', () => {
    const wrapper = mountDiff([
      { path: '/repo/src/app.ts', oldText: 'a\nb\nc\n', newText: 'a\nB\nc\nd\n' }
    ]);
    expect(wrapper.text()).toContain('/repo/src/');
    expect(wrapper.text()).toContain('app.ts');
    expect(wrapper.get('[data-testid="tool-diff-added"]').text()).toBe('+2');
    expect(wrapper.get('[data-testid="tool-diff-removed"]').text()).toBe('−1');
    expect(wrapper.findAll('.diff-row--added')).toHaveLength(2);
    expect(wrapper.findAll('.diff-row--removed')).toHaveLength(1);
    expect(wrapper.findAll('.diff-row--hunk')).toHaveLength(1);
  });

  it('renders a null oldText as all-added lines', () => {
    const wrapper = mountDiff([{ path: 'new.ts', oldText: null, newText: 'one\ntwo\n' }]);
    expect(wrapper.get('[data-testid="tool-diff-added"]').text()).toBe('+2');
    expect(wrapper.get('[data-testid="tool-diff-removed"]').text()).toBe('−0');
    expect(wrapper.findAll('.diff-row--removed')).toHaveLength(0);
  });

  it('shows diffs of up to 40 lines without a toggle', () => {
    const wrapper = mountDiff([{ path: 'new.ts', oldText: null, newText: numberedLines(40) }]);
    expect(wrapper.find('[data-testid="tool-diff-toggle"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="tool-diff-body"]').exists()).toBe(true);
  });

  it('collapses diffs over 40 lines behind a toggle across all entries', async () => {
    const onToggle = vi.fn();
    const wrapper = mountDiff(
      [
        { path: 'a.ts', oldText: null, newText: numberedLines(20) },
        { path: 'b.ts', oldText: null, newText: numberedLines(21) }
      ],
      onToggle
    );
    const toggle = wrapper.get('[data-testid="tool-diff-toggle"]');
    expect(toggle.text()).toContain('+41');
    expect(wrapper.find('[data-testid="tool-diff-body"]').exists()).toBe(false);
    await toggle.trigger('click');
    expect(onToggle).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ bExpanded: true });
    expect(wrapper.find('[data-testid="tool-diff-body"]').exists()).toBe(true);
  });
});
