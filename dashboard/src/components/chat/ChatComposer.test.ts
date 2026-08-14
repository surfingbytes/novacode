// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

// components
import ChatComposer from '@/components/chat/ChatComposer.vue';

function mountComposer(overrides: Record<string, unknown> = {}) {
  return mount(ChatComposer, {
    attachTo: document.getElementById('app')!,
    props: {
      bIsStreaming: false,
      bWsConnected: true,
      queuedPrompts: [],
      modeOptions: [],
      displaySessionMode: 'agent',
      selectedModeLabel: 'Agent',
      selectedModeIcon: 'agent',
      bModesLoading: false,
      bSavingSessionMode: false,
      modelSelection: 'auto',
      modelOptions: [],
      thinkingOptions: null,
      bModelsLoading: false,
      bSavingModelSelection: false,
      bSelectedModelMissing: false,
      agentConfigOptions: [],
      agentConfigDisplayValue: () => '',
      bConfigLoading: false,
      bSavingSessionConfig: false,
      hideThinkingOutput: true,
      approvalPolicy: 'ask',
      bSavingApprovalPolicy: false,
      bMdUp: true,
      bUploadingImage: false,
      promptText: '',
      pendingImages: [],
      ...overrides
    }
  });
}

describe('ChatComposer send controls', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    setActivePinia(createPinia());
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false
      })
    });
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class {
        observe(): void {
          return;
        }
        unobserve(): void {
          return;
        }
        disconnect(): void {
          return;
        }
      } as typeof ResizeObserver;
    }
  });

  it('sends on Enter and inserts a newline on Ctrl+Enter', async () => {
    const onSend = vi.fn();
    const wrapper = mountComposer({ promptText: 'hello', onSend });
    await nextTick();
    const textarea = wrapper.get('textarea');
    await textarea.setValue('hello');

    await textarea.trigger('keydown.enter', { ctrlKey: true, key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();

    await textarea.trigger('keydown.enter', { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith({ text: 'hello', imagePaths: [] });
  });

  it('turns the primary button into Stop while streaming with an empty draft', async () => {
    const onCancel = vi.fn();
    const onSend = vi.fn();
    const wrapper = mountComposer({ bIsStreaming: true, promptText: '', onCancel, onSend });
    await nextTick();
    const button = wrapper.get('button[aria-label="Stop generating"]');
    expect(button.attributes('disabled')).toBeUndefined();
    await button.trigger('click');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('queues a follow-up from the primary button while streaming', async () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    const wrapper = mountComposer({ bIsStreaming: true, promptText: '', onSend, onCancel });
    await nextTick();
    await wrapper.get('textarea').setValue('next');
    await nextTick();
    const button = wrapper.get('button[aria-label="Queue message"]');
    await button.trigger('click');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('labels the approval control as Ask or Allow all', async () => {
    const wrapper = mountComposer();
    await nextTick();
    expect(wrapper.get('button[aria-label="Approval policy: Ask"]').text()).toContain('Ask');
    await wrapper.setProps({ approvalPolicy: 'allow_all' });
    await nextTick();
    expect(wrapper.get('button[aria-label="Approval policy: Allow all"]').text()).toContain(
      'Allow all'
    );
  });
});
