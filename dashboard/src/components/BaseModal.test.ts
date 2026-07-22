// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';

// components
import BaseModal from '@/components/BaseModal.vue';

describe('BaseModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });

  it('teleports its panel to document.body when opened', async () => {
    const Host = defineComponent({
      components: { BaseModal },
      setup() {
        return () =>
          h(BaseModal, { modelValue: true, labelledby: 't' }, () => h('p', { id: 'slot-marker' }, 'hello'));
      }
    });
    mount(Host, { attachTo: document.getElementById('app')! });
    await nextTick();

    const marker = document.body.querySelector('#slot-marker');
    expect(marker).toBeTruthy();
    // must be inside the fixed overlay at body level, not inline in #app
    const overlay = document.body.querySelector('.fixed.inset-0');
    expect(overlay).toBeTruthy();
    expect(overlay!.contains(marker)).toBe(true);
    // and NOT inside the host app container
    expect(document.getElementById('app')!.contains(marker)).toBe(false);
  });

  it('renders nothing when closed', async () => {
    const Host = defineComponent({
      components: { BaseModal },
      setup() {
        return () =>
          h(BaseModal, { modelValue: false, labelledby: 't' }, () => h('p', { id: 'slot-marker' }, 'hello'));
      }
    });
    mount(Host, { attachTo: document.getElementById('app')! });
    await nextTick();
    expect(document.body.querySelector('#slot-marker')).toBeNull();
  });
});
