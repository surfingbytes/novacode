// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

// components
import NewSessionModal from '@/components/NewSessionModal.vue';

function mountModal(attrs: Record<string, unknown> = {}) {
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
            },
            ...attrs
          })
        ]);
    }
  });
  const wrapper = mount(Host, { attachTo: document.getElementById('app')! });
  return { wrapper, created };
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

    const agentGroup = document.body.querySelector('[aria-label="Approval policy"]');
    expect(agentGroup).toBeTruthy();

    const overlay = document.body.querySelector('.fixed.inset-0');
    expect(overlay).toBeTruthy();
    expect(overlay!.contains(agentGroup!)).toBe(true);

    expect(document.getElementById('host')!.contains(agentGroup!)).toBe(false);
    expect(document.getElementById('host')!.querySelector('basemodal')).toBeNull();
  });

  it('keeps name and tags under Advanced, collapsed by default', async () => {
    mountModal();
    await nextTick();
    await nextTick();

    expect(document.body.querySelector('#new-session-name')).toBeNull();
    expect(document.body.querySelector('#new-session-tags-panel')).toBeNull();

    const toggle = document.body.querySelector<HTMLButtonElement>(
      'button[aria-controls="new-session-advanced-panel"]'
    );
    expect(toggle).toBeTruthy();
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');

    toggle!.click();
    await nextTick();

    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.querySelector('#new-session-name')).toBeTruthy();
    expect(document.body.querySelector('#new-session-tags-panel')).toBeNull();

    const tagsToggle = document.body.querySelector<HTMLButtonElement>(
      'button[aria-controls="new-session-tags-panel"]'
    );
    expect(tagsToggle).toBeTruthy();
    tagsToggle!.click();
    await nextTick();
    expect(document.body.querySelector('#new-session-tags-panel')).toBeTruthy();
  });

  it('emits an empty name when Advanced is left blank', async () => {
    const { created } = mountModal();
    await nextTick();
    await nextTick();

    const form = document.body.querySelector('form');
    expect(form).toBeTruthy();
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await nextTick();

    expect(created.value).toBeTruthy();
    expect(created.value!.name).toBe('');
    expect(created.value!.agentType).toBe('cursor-agent');
    expect(created.value!.approvalPolicy).toBe('ask');
  });

  it('defaults approval to Ask and emits the selected policy on create', async () => {
    const { created } = mountModal();
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
