// @vitest-environment jsdom
// node_modules
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, nextTick, ref } from 'vue';

const persistPlanUpdate = vi.fn();
vi.mock('@/classes/api', () => ({
  sessionsApi: {
    persistPlanUpdate: (...args: unknown[]) => persistPlanUpdate(...args),
    get: vi.fn(),
    deletePlanDocument: vi.fn()
  }
}));

// composables
import { usePlanDocuments } from './usePlanDocuments';

// utils
import { parseHistoryEventsCached, prepareDisplayItem } from '@/utils/chatDisplayItems';

// types
import type { Session } from '@/@types/index';

interface HistoryMessage {
  role: 'user' | 'assistant';
  createdAt: string;
  events: string[];
}

function planLine(markdown: string, entries: Array<{ content: string; status: string }> = []): string {
  return JSON.stringify({
    sessionId: 'acp-1',
    update: { sessionUpdate: 'plan', title: 'Plan', markdown, entries }
  });
}

function mountPlanDocuments(messages: HistoryMessage[], onStartPlanSession: () => void = () => {}) {
  const displayMessages = computed(() =>
    messages.map((msg, index) => {
      const items =
        msg.role === 'assistant'
          ? parseHistoryEventsCached(msg.events).map(prepareDisplayItem)
          : [];
      for (const item of items) {
        if (item.kind === 'plan') item.planId = `${msg.createdAt}-${index}-plan-0`;
      }
      return { msg, key: `${msg.createdAt}-${index}`, items, fallbackHtml: '' };
    })
  );
  return usePlanDocuments({
    workspaceId: () => 'ws-1',
    sessionId: () => 'session-1',
    session: ref({ id: 'session-1', agentType: 'claude', planDocuments: [] } as unknown as Session),
    displayMessages,
    streamingDisplayItems: computed(() => []),
    activeTab: ref('plan'),
    modelSelection: ref(''),
    onStartPlanSession
  });
}

describe('usePlanDocuments mark-as-done', () => {
  beforeEach(() => {
    persistPlanUpdate.mockReset();
    persistPlanUpdate.mockResolvedValue({ data: { ok: true } });
  });

  it('persists cumulative plan updates that survive a history reload', async () => {
    const history: HistoryMessage[] = [
      { role: 'user', createdAt: '1', events: [] },
      { role: 'assistant', createdAt: '2', events: [planLine('# Plan\n\n1. First\n2. Second\n3. Third')] }
    ];
    const view = mountPlanDocuments(history);

    for (const index of [0, 2]) {
      const plan = view.selectedPlanDocument.value!;
      await view.markPlanEntryDone(plan, plan.startableEntries[index], index);
      await nextTick();
    }
    expect(view.selectedPlanDocument.value?.completedCount).toBe(2);
    expect(persistPlanUpdate).toHaveBeenCalledTimes(2);

    // Server appends each payload as a plan event on the plan-bearing message.
    const reloaded = history.map((msg) => ({ ...msg, events: [...msg.events] }));
    for (const [, , payload] of persistPlanUpdate.mock.calls) {
      reloaded[1].events.push(planLine(payload.markdown, payload.entries));
    }
    const plan = mountPlanDocuments(reloaded).selectedPlanDocument.value!;
    expect(plan.completedCount).toBe(2);
    expect(plan.startableEntries.map((entry) => entry.content)).toEqual([
      'First - done',
      'Second',
      'Third - done'
    ]);
  });

  it('starts a session only from the Start session button', () => {
    const onStartPlanSession = vi.fn();
    const view = mountPlanDocuments(
      [{ role: 'assistant', createdAt: '1', events: [planLine('# Plan\n\n1. First\n\nDetails\n\n2. Second')] }],
      onStartPlanSession
    );
    const host = document.createElement('div');
    host.innerHTML = view.selectedPlanDocument.value!.renderedHtml;
    const click = (el: Element) =>
      view.onPlanMarkdownClick({ target: el } as unknown as MouseEvent);

    click(host.querySelector('.plan-step-body p')!);
    click(host.querySelector('.plan-step-title')!);
    expect(onStartPlanSession).not.toHaveBeenCalled();

    click(host.querySelector('button.plan-start-session-btn')!);
    expect(onStartPlanSession).toHaveBeenCalledTimes(1);
  });

  it('rolls back the optimistic mark when persisting fails', async () => {
    persistPlanUpdate.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = mountPlanDocuments([
      { role: 'assistant', createdAt: '1', events: [planLine('# Plan\n\n1. First\n2. Second')] }
    ]);
    const plan = view.selectedPlanDocument.value!;
    await view.markPlanEntryDone(plan, plan.startableEntries[0], 0);
    await nextTick();
    expect(view.selectedPlanDocument.value?.completedCount).toBe(0);
  });
});
