// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { settingsApi } from '@/classes/api';
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
