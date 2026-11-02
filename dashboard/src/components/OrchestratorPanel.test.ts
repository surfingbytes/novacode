// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { computed, defineComponent, h, ref } from 'vue';

// classes
import { parseSubtasksPayloadString, serializeSubtasksPayload } from '@/utils/orchestratorPayload';

// types
import type { Orchestrator, SubTask } from '@/@types/index';

const { updateMock } = vi.hoisted(() => ({ updateMock: vi.fn() }));

vi.mock('@/classes/api', () => ({ orchestratorApi: { update: updateMock } }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/stores/novaMcp', () => ({ useNovaMcpStore: () => ({ bEnabled: true, ensureFetched: vi.fn() }) }));
vi.mock('@/stores/workspaces', () => ({ useWorkspacesStore: () => ({ allSessions: [] }) }));
vi.mock('@/composables/useOrchestratorRunState', () => ({
  useOrchestratorRunState: (opts: { orchestrator: () => Orchestrator | null }) => ({
    bStartingRun: ref(false),
    bStopping: ref(false),
    runError: ref(null),
    preferredRunMode: ref('sequential'),
    parallelBlockedReason: ref(null),
    isRunning: ref(false),
    maxParallel: ref(1),
    subtasks: computed(() => parseSubtasksPayloadString(opts.orchestrator()?.subtasksJson)?.subtasks ?? []),
    sharedContextDisplay: ref(''),
    handoffLogDisplay: ref(''),
    runProgress: ref(null),
    runSummary: ref(null),
    startRun: vi.fn(),
    stopTasks: vi.fn()
  })
}));

// components
import OrchestratorPanel from '@/components/OrchestratorPanel.vue';
import OrchestratorStepRow from '@/components/orchestrator/OrchestratorStepRow.vue';

function orchestratorWith(names: string[]): Orchestrator {
  const subtasks = names.map((name) => ({ name, prompt: `do ${name}` }));
  return {
    id: 'orch-1',
    subtasksJson: serializeSubtasksPayload({ sharedContext: '', handoffLog: '', subtasks })
  } as unknown as Orchestrator;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function sentNames(callIndex: number): string[] {
  const body = updateMock.mock.calls[callIndex][2] as { subtasksJson: string };
  return (parseSubtasksPayloadString(body.subtasksJson)?.subtasks ?? []).map((t) => t.name);
}

describe('OrchestratorPanel step saves', () => {
  beforeEach(() => {
    updateMock.mockReset();
  });

  it('serializes overlapping saves so the latest step order wins', async () => {
    const orchestrator = ref<Orchestrator>(orchestratorWith(['A', 'B', 'C']));
    const Host = defineComponent({
      setup() {
        return () =>
          h(OrchestratorPanel, {
            workspaceId: 'ws',
            orchestratorId: 'orch-1',
            orchestrator: orchestrator.value,
            'onUpdate:orchestrator': (next: Orchestrator) => {
              orchestrator.value = next;
            }
          });
      }
    });
    const wrapper = mount(Host, {
      global: {
        stubs: {
          OrchestratorStepRow: true,
          OrchestratorPlannerBanner: true,
          OrchestratorRunSettings: true,
          OrchestratorSpecCard: true,
          OrchestratorPlanNotes: true,
          OrchestratorStepEditModal: true,
          OrchestratorRunProgress: true,
          OrchestratorRunSplitButton: true,
          ConfirmModal: true
        }
      }
    });
    const names = () =>
      wrapper.findAllComponents(OrchestratorStepRow).map((row) => (row.props('task') as SubTask).name);

    const firstSave = deferred<{ data: Orchestrator }>();
    const secondSave = deferred<{ data: Orchestrator }>();
    updateMock.mockReturnValueOnce(firstSave.promise).mockReturnValueOnce(secondSave.promise);

    wrapper.findAllComponents(OrchestratorStepRow)[0].vm.$emit('move-down');
    await flushPromises();
    wrapper.findAllComponents(OrchestratorStepRow)[1].vm.$emit('move-down');
    await flushPromises();
    expect(names()).toEqual(['B', 'C', 'A']);
    // The second edit waits for the first save instead of overlapping it.
    expect(updateMock).toHaveBeenCalledTimes(1);

    firstSave.resolve({ data: orchestratorWith(['B', 'A', 'C']) });
    await flushPromises();
    // The superseded response must not reset the UI to the older order.
    expect(names()).toEqual(['B', 'C', 'A']);
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(sentNames(1)).toEqual(['B', 'C', 'A']);

    secondSave.resolve({ data: orchestratorWith(['B', 'C', 'A']) });
    await flushPromises();
    expect(names()).toEqual(['B', 'C', 'A']);
    expect(updateMock).toHaveBeenCalledTimes(2);
  });
});
