// @vitest-environment jsdom

// node_modules
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

// components
import OrchestratorStepRow from '@/components/orchestrator/OrchestratorStepRow.vue';

// types
import type { SubTask } from '@/@types/index';
import type { StepStatus } from '@/composables/useOrchestratorRunState';

type Props = InstanceType<typeof OrchestratorStepRow>['$props'];

let mounted: VueWrapper | null = null;

function mountRow(task: Partial<SubTask>, overrides: Partial<Props> = {}): VueWrapper {
  mounted = mount(OrchestratorStepRow, {
    props: {
      task: { name: 'Build API', prompt: 'Do the thing.', ...task },
      index: 1,
      status: 'idle' as StepStatus,
      isRunning: false,
      canEdit: true,
      bStartingRun: false,
      handoffNote: null,
      ...overrides
    }
  });
  return mounted;
}

function text(wrapper: VueWrapper, selector: string): string | null {
  const el = wrapper.find(selector);
  return el.exists() ? el.text() : null;
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe('OrchestratorStepRow prompt', () => {
  it('clamps the prompt to two lines and offers Show more only when text is hidden', () => {
    const wrapper = mountRow({}, { status: 'idle' });
    const prompt = wrapper.find('[data-testid="step-prompt"]');
    expect(prompt.exists()).toBe(true);
    expect(prompt.classes()).toContain('line-clamp-2');
    // jsdom has no layout, so nothing overflows and the toggle stays hidden.
    expect(wrapper.find('[data-testid="step-prompt-toggle"]').exists()).toBe(false);
  });

  it('hides the prompt of automatic steps until Show more', async () => {
    const wrapper = mountRow({ kind: 'merge', prompt: 'Merge everything' });
    expect(wrapper.find('[data-testid="step-prompt"]').exists()).toBe(false);
    const toggle = wrapper.find('[data-testid="step-prompt-toggle"]');
    expect(toggle.text()).toBe('Show more');
    await toggle.trigger('click');
    await nextTick();
    const prompt = wrapper.find('[data-testid="step-prompt"]');
    expect(prompt.text()).toBe('Merge everything');
    expect(prompt.classes()).not.toContain('line-clamp-2');
    expect(text(wrapper, '[data-testid="step-prompt-toggle"]')).toBe('Show less');
  });

  it('keeps the run note visible without the prompt on automatic steps', () => {
    const wrapper = mountRow({ kind: 'verify', runNote: 'Kept on branch x', runResult: 'done' });
    expect(wrapper.find('[data-testid="step-prompt"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Kept on branch x');
  });
});

describe('OrchestratorStepRow result', () => {
  it('offers a collapsed Result section for finished steps only', async () => {
    const idle = mountRow({});
    expect(idle.find('[data-testid="step-result-toggle"]').exists()).toBe(false);
    idle.unmount();

    const wrapper = mountRow(
      {
        runResult: 'done',
        startedAt: '2026-10-29T10:00:00.000Z',
        finishedAt: '2026-10-29T10:04:12.000Z'
      },
      { status: 'done', handoffNote: 'Added routes.\nAll tests pass.' }
    );
    expect(wrapper.find('[data-testid="step-result"]').exists()).toBe(false);
    const toggle = wrapper.find('[data-testid="step-result-toggle"]');
    expect(toggle.text()).toBe('Result ▸');
    await toggle.trigger('click');
    const result = wrapper.find('[data-testid="step-result"]');
    expect(result.exists()).toBe(true);
    expect(result.find('pre').text()).toBe('Added routes.\nAll tests pass.');
    expect(result.text()).toContain('took 4m 12s');
    expect(text(wrapper, '[data-testid="step-result-toggle"]')).toBe('Result ▾');
  });

  it('explains a missing handoff note for a failed step', async () => {
    const wrapper = mountRow({ runResult: 'failed', runNote: 'exit 1' }, { status: 'failed' });
    await wrapper.find('[data-testid="step-result-toggle"]').trigger('click');
    expect(wrapper.find('[data-testid="step-result"]').text()).toContain('No report recorded');
    expect(wrapper.text()).toContain('exit 1');
  });
});

describe('OrchestratorStepRow branch actions', () => {
  const keptBranch = { base: 'abc123', branch: 'nova/plan/step-2' };

  it('offers Apply/Discard only for steps with a kept branch while no run is active', () => {
    const plain = mountRow({});
    expect(plain.find('[data-testid="step-apply-branch"]').exists()).toBe(false);
    plain.unmount();

    const running = mountRow({ keptBranch, runResult: 'failed' }, { status: 'failed', isRunning: true, canEdit: false });
    expect(running.find('[data-testid="step-apply-branch"]').exists()).toBe(false);
    expect(running.find('[data-testid="step-discard-branch"]').exists()).toBe(false);
    running.unmount();

    const wrapper = mountRow({ keptBranch, runResult: 'failed' }, { status: 'failed' });
    const apply = wrapper.find('[data-testid="step-apply-branch"]');
    expect(apply.text()).toBe('Apply branch');
    expect(apply.attributes('title')).toBe(
      "Apply this branch's changes to the workspace as uncommitted changes"
    );
    expect(wrapper.find('[data-testid="step-discard-branch"]').text()).toBe('Discard branch');
  });

  it('emits apply-branch / discard-branch and disables both while a request is in flight', async () => {
    // Listener props rather than wrapper.emitted(): emit tracking is off under NODE_ENV=production.
    const onApplyBranch = vi.fn();
    const onDiscardBranch = vi.fn();
    const wrapper = mountRow(
      { keptBranch, runResult: 'failed' },
      { status: 'failed', onApplyBranch, onDiscardBranch } as Partial<Props>
    );
    await wrapper.find('[data-testid="step-apply-branch"]').trigger('click');
    await wrapper.find('[data-testid="step-discard-branch"]').trigger('click');
    expect(onApplyBranch).toHaveBeenCalledTimes(1);
    expect(onDiscardBranch).toHaveBeenCalledTimes(1);

    await wrapper.setProps({ bBranchBusy: true });
    expect(wrapper.find('[data-testid="step-apply-branch"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="step-discard-branch"]').attributes('disabled')).toBeDefined();
  });
});

describe('OrchestratorStepRow move buttons', () => {
  it('shows Move up / Move down for editable manual steps only', () => {
    const auto = mountRow({ kind: 'merge' });
    expect(auto.find('[data-testid="step-move-up"]').exists()).toBe(false);
    auto.unmount();

    const locked = mountRow({}, { canEdit: false });
    expect(locked.find('[data-testid="step-move-up"]').exists()).toBe(false);
    locked.unmount();

    const wrapper = mountRow({}, { bCanMoveUp: true, bCanMoveDown: false });
    const up = wrapper.find('[data-testid="step-move-up"]');
    const down = wrapper.find('[data-testid="step-move-down"]');
    expect(up.attributes('disabled')).toBeUndefined();
    expect(down.attributes('disabled')).toBeDefined();
    expect(up.attributes('aria-label')).toBe('Move up');
    expect(down.attributes('aria-label')).toBe('Move down');
  });

  it('emits move-up / move-down when allowed', async () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    const wrapper = mountRow(
      {},
      { bCanMoveUp: true, bCanMoveDown: true, onMoveUp, onMoveDown } as Partial<Props>
    );
    await wrapper.find('[data-testid="step-move-up"]').trigger('click');
    await wrapper.find('[data-testid="step-move-down"]').trigger('click');
    expect(onMoveUp).toHaveBeenCalledTimes(1);
    expect(onMoveDown).toHaveBeenCalledTimes(1);
  });

  it('keeps edit and delete available next to the move buttons', () => {
    const wrapper = mountRow({});
    expect(wrapper.find('[aria-label="Edit step"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Delete step"]').exists()).toBe(true);
  });
});

describe('OrchestratorStepRow elapsed time', () => {
  it('shows nothing without startedAt', () => {
    const wrapper = mountRow({ runResult: 'done' }, { status: 'done' });
    expect(wrapper.find('[data-testid="step-elapsed"]').exists()).toBe(false);
  });

  it('shows the stored duration for finished steps', () => {
    const wrapper = mountRow(
      {
        runResult: 'done',
        startedAt: '2026-10-29T10:00:00.000Z',
        finishedAt: '2026-10-29T11:03:30.000Z'
      },
      { status: 'done' }
    );
    expect(text(wrapper, '[data-testid="step-elapsed"]')).toBe('1h 03m');
  });

  it('ticks once per second while the step is running and stops when it finishes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T10:00:10.000Z'));
    const wrapper = mountRow(
      { runResult: 'running', startedAt: '2026-10-29T10:00:00.000Z' },
      { status: 'active' }
    );
    expect(text(wrapper, '[data-testid="step-elapsed"]')).toBe('10s');

    vi.advanceTimersByTime(2_000);
    await nextTick();
    expect(text(wrapper, '[data-testid="step-elapsed"]')).toBe('12s');

    await wrapper.setProps({
      status: 'done',
      task: {
        name: 'Build API',
        prompt: 'Do the thing.',
        runResult: 'done',
        startedAt: '2026-10-29T10:00:00.000Z',
        finishedAt: '2026-10-29T10:00:15.000Z'
      }
    });
    expect(text(wrapper, '[data-testid="step-elapsed"]')).toBe('15s');
    vi.advanceTimersByTime(5_000);
    await nextTick();
    expect(text(wrapper, '[data-testid="step-elapsed"]')).toBe('15s');
    expect(vi.getTimerCount()).toBe(0);
  });
});
