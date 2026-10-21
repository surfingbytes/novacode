// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { settingsApi } from '@/classes/api';
import { useAgentCapabilities } from '@/composables/useAgentCapabilities';

vi.mock('@/classes/api', () => ({
  settingsApi: {
    getAgentCapabilities: vi.fn()
  }
}));

const ALL_ON = {
  claudeAvailable: true,
  cursorAvailable: true,
  mistralVibeAvailable: true,
  openCodeAvailable: true,
  codexAvailable: true
};

/**
 * Regression: the reconnect refresh cleared the "loaded" flag before fetching,
 * so a failed refresh wiped every agent to unavailable and the new-session
 * modal showed "No agents available".
 */
describe('useAgentCapabilities on a flaky connection', () => {
  beforeEach(() => {
    vi.mocked(settingsApi.getAgentCapabilities).mockReset();
  });

  it('keeps loaded capabilities when a reconnect refresh fails', async () => {
    vi.mocked(settingsApi.getAgentCapabilities).mockResolvedValueOnce({ data: ALL_ON } as never);
    const caps = useAgentCapabilities();
    await caps.reload();
    expect(caps.bCapabilitiesLoaded.value).toBe(true);
    expect(caps.claudeAvailable.value).toBe(true);

    vi.mocked(settingsApi.getAgentCapabilities).mockRejectedValueOnce(new Error('network'));
    await caps.reload();

    expect(caps.bCapabilitiesLoaded.value).toBe(true);
    expect(caps.claudeAvailable.value).toBe(true);
    expect(caps.cursorAvailable.value).toBe(true);
    expect(caps.codexAvailable.value).toBe(true);
  });
});
