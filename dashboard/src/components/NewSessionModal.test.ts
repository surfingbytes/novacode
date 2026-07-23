// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

// components
import NewSessionModal from '@/components/NewSessionModal.vue';

function mountModal() {
  const Host = defineComponent({
    components: { NewSessionModal },
    setup() {
      return () =>
        h('div', { id: 'host' }, [
          h(NewSessionModal, {
            modelValue: true,
            cursorAvailable: true,
            claudeAvailable: true,
            mistralVibeAvailable: false,
            openCodeAvailable: false,
            codexAvailable: false
          })
        ]);
    }
  });
  return mount(Host, { attachTo: document.getElementById('app')! });
}

/**
 * Regression test: NewSessionModal used <BaseModal> without importing it,
 * so Vue rendered it as an unresolved <basemodal> element and the dialog
 * appeared inline in the page instead of a teleported overlay.
 */
describe('NewSessionModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('renders its form inside a teleported overlay, not inline', async () => {
    mountModal();
    await nextTick();
    await nextTick();

    const nameInput = document.body.querySelector('#new-session-name');
    expect(nameInput).toBeTruthy();

    // the fixed overlay lives at body level and contains the form
    const overlay = document.body.querySelector('.fixed.inset-0');
    expect(overlay).toBeTruthy();
    expect(overlay!.contains(nameInput!)).toBe(true);

    // nothing of the dialog renders inline in the host
    expect(document.getElementById('host')!.contains(nameInput!)).toBe(false);
    expect(document.getElementById('host')!.querySelector('basemodal')).toBeNull();
  });

  it('keeps tags collapsed by default and expands them via the toggle', async () => {
    mountModal();
    await nextTick();
    await nextTick();

    const toggle = document.body.querySelector<HTMLButtonElement>(
      'button[aria-controls="new-session-tags-panel"]'
    );
    expect(toggle).toBeTruthy();
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.querySelector('#new-session-tags-panel')).toBeNull();

    toggle!.click();
    await nextTick();

    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.querySelector('#new-session-tags-panel')).toBeTruthy();
  });
});
