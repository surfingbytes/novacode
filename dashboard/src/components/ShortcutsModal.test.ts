// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

// components
import ShortcutsModal from '@/components/ShortcutsModal.vue';

// lib
import { SEND_ON_ENTER_KEY } from '@/lib/sendOnEnter';

function rowKeys(description: string): string {
  const row = Array.from(document.body.querySelectorAll('.shortcuts__row')).find(
    (element) => element.querySelector('.shortcuts__description')?.textContent === description
  );
  if (!row) {
    throw new Error(`row not found: ${description}`);
  }
  return Array.from(row.querySelectorAll('kbd'))
    .map((element) => element.textContent)
    .join(' ');
}

async function mountOpen(): Promise<void> {
  mount(ShortcutsModal, {
    props: { modelValue: true },
    attachTo: document.getElementById('app')!
  });
  await nextTick();
}

describe('ShortcutsModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders every group', async () => {
    await mountOpen();
    const titles = Array.from(document.body.querySelectorAll('.shortcuts__group-title')).map(
      (element) => element.textContent
    );
    expect(titles).toEqual(['Global', 'Chat', 'Files', 'Lists and menus']);
    expect(rowKeys('Keyboard shortcuts')).toBe('?');
    expect(rowKeys('Recall previous prompts (empty composer)')).toBe('↑ ↓');
  });

  it('shows Ctrl on non-Apple platforms', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' });
    await mountOpen();
    expect(rowKeys('Search')).toBe('Ctrl K');
    expect(rowKeys('Save file')).toBe('Ctrl S');
  });

  it('shows ⌘ on Apple platforms', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' });
    await mountOpen();
    expect(rowKeys('Search')).toBe('⌘ K');
    expect(rowKeys('Find in chat')).toBe('⌘ F');
  });

  it('reflects the send-key preference', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' });
    await mountOpen();
    expect(rowKeys('Send message')).toBe('Enter');
    expect(rowKeys('Insert newline')).toBe('Ctrl Enter');

    document.body.innerHTML = '<div id="app"></div>';
    localStorage.setItem(SEND_ON_ENTER_KEY, '0');
    await mountOpen();
    expect(rowKeys('Send message')).toBe('Ctrl Enter');
    expect(rowKeys('Insert newline')).toBe('Enter');
  });
});
