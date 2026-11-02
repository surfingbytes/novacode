// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { sessionsApi, settingsApi } from '@/classes/api';
import { useAgentOptions } from '@/composables/useAgentOptions';
import type { AgentModelOption, Session } from '@/@types/index';

vi.mock('@/classes/api', () => ({
  settingsApi: {
    getAgentOptions: vi.fn()
  },
  sessionsApi: {
    update: vi.fn()
  }
}));

const OPUS: AgentModelOption = {
  id: 'opus',
  label: 'Opus',
  model: 'Opus',
  thinking: 'High',
  context: 'Default',
  fast: null
};

function sessionFixture(): Session {
  return {
    id: 's-1',
    workspaceId: 'ws-1',
    agentType: 'claude',
    modelSelection: 'opus'
  } as unknown as Session;
}

function setup() {
  const session = ref<Session | null>(sessionFixture());
  const options = useAgentOptions({
    workspaceId: () => 'ws-1',
    sessionId: () => 's-1',
    session
  });
  options.applyFetchedSession(session.value!);
  return options;
}

/**
 * Regression: on a flaky connection a failed agent-options request replaced the
 * catalog with just "Auto", so the saved model was reported as "not found"
 * while the picker still showed it.
 */
describe('useAgentOptions on a flaky connection', () => {
  beforeEach(() => {
    vi.mocked(settingsApi.getAgentOptions).mockReset();
  });

  it('does not flag the saved model as missing when the catalog never loaded', async () => {
    vi.mocked(settingsApi.getAgentOptions).mockRejectedValueOnce(new Error('network'));
    const options = setup();

    await options.loadAgentOptions();

    expect(options.bSelectedModelMissing.value).toBe(false);
    expect(options.bAgentOptionsLoadFailed.value).toBe(true);
  });

  it('keeps a loaded catalog when a later refetch fails', async () => {
    vi.mocked(settingsApi.getAgentOptions).mockResolvedValueOnce({
      data: { models: [OPUS], modes: [], configOptions: [], thinking: null }
    } as never);
    const options = setup();
    await options.loadAgentOptions();
    expect(options.modelOptions.value.map((o) => o.id)).toEqual(['opus']);
    expect(options.bSelectedModelMissing.value).toBe(false);

    vi.mocked(settingsApi.getAgentOptions).mockRejectedValueOnce(new Error('network'));
    await options.loadAgentOptions();

    expect(options.modelOptions.value.map((o) => o.id)).toEqual(['opus']);
    expect(options.bSelectedModelMissing.value).toBe(false);
    expect(options.bModelsLoading.value).toBe(false);
  });

  it('still flags a genuinely unknown saved model after a successful load', async () => {
    vi.mocked(settingsApi.getAgentOptions).mockResolvedValueOnce({
      data: { models: [{ ...OPUS, id: 'sonnet', model: 'Sonnet' }], modes: [], configOptions: [], thinking: null }
    } as never);
    const options = setup();

    await options.loadAgentOptions();

    expect(options.bSelectedModelMissing.value).toBe(true);
  });
});

describe('useAgentOptions across a session switch', () => {
  beforeEach(() => {
    vi.mocked(sessionsApi.update).mockReset();
  });

  function setupSwitchable() {
    let sessionId = 's-1';
    const session = ref<Session | null>(sessionFixture());
    const options = useAgentOptions({ workspaceId: () => 'ws-1', sessionId: () => sessionId, session });
    options.applyFetchedSession(session.value!);
    const switchTo = (next: Session) => {
      sessionId = next.id;
      options.resetAgentOptions();
      session.value = next;
      options.applyFetchedSession(next);
    };
    return { options, session, switchTo };
  }

  const otherSession = { ...sessionFixture(), id: 's-2', modelSelection: 'sonnet', sessionMode: 'ask' };

  it('drops a model save that resolves after switching sessions', async () => {
    let finish: (value: unknown) => void = () => undefined;
    vi.mocked(sessionsApi.update).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)) as never);
    const { options, session, switchTo } = setupSwitchable();

    options.onSharedModelPickerUpdate('haiku');
    switchTo(otherSession);
    finish({ data: { ...sessionFixture(), modelSelection: 'haiku' } });
    await Promise.resolve();
    await Promise.resolve();

    expect(session.value?.id).toBe('s-2');
    expect(options.modelSelection.value).toBe('sonnet');
    expect(options.bSavingModelSelection.value).toBe(false);
  });

  it('drops mode and config saves that resolve after switching sessions', async () => {
    const finishers: Array<(value: unknown) => void> = [];
    vi.mocked(sessionsApi.update).mockImplementation(
      () => new Promise((resolve) => finishers.push(resolve)) as never
    );
    const { options, session, switchTo } = setupSwitchable();

    options.onSessionModeChange('plan');
    options.onAgentConfigChange('effort', 'high');
    switchTo(otherSession);
    for (const finish of finishers) {
      finish({ data: { ...sessionFixture(), sessionMode: 'plan', sessionConfigJson: { effort: 'high' } } });
    }
    await Promise.resolve();
    await Promise.resolve();

    expect(session.value).toEqual(otherSession);
    expect(options.sessionMode.value).toBe('ask');
    expect(options.sessionConfig.value).toEqual({});
  });
});

