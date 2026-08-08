// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
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

  it('defaults approval to Ask and emits the selected policy on create', async () => {
    const created = ref<Record<string, unknown> | null>(null);
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
              codexAvailable: false,
              onCreate: (payload: Record<string, unknown>) => {
                created.value = payload;
              }
            })
          ]);
      }
    });
    mount(Host, { attachTo: document.getElementById('app')! });
    await nextTick();
    await nextTick();

    const group = document.body.querySelector('[aria-label="Approval policy"]');
    expect(group).toBeTruthy();
    const buttons = group!.querySelectorAll<HTMLButtonElement>('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');

    buttons[1].click();
    await nextTick();
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');

    const form = document.body.querySelector('form');
    expect(form).toBeTruthy();
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await nextTick();

    expect(created.value).toBeTruthy();
    expect(created.value!.approvalPolicy).toBe('allow_all');
  });
});
