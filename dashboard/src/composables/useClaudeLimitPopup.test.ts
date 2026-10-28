// @vitest-environment jsdom
// node_modules
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/classes/api', () => ({
  settingsApi: {
    get: vi.fn()
  }
}));

// classes
import { settingsApi } from '@/classes/api';

// composables
import { useClaudeLimitPopup } from './useClaudeLimitPopup';

describe('useClaudeLimitPopup', () => {
  beforeEach(() => {
    vi.mocked(settingsApi.get).mockReset();
  });

  it('shows the popup with the reset time when a limit is detected', () => {
    const popup = useClaudeLimitPopup();
    popup.onClaudeLimitDetected('2026-10-28T20:00:00Z', '8 PM');
    expect(popup.bShowClaudeLimitPopup.value).toBe(true);
    expect(popup.claudeLimitResetTime.value).toBe('2026-10-28T20:00:00Z');
    expect(popup.claudeLimitResetTimeReadable.value).toBe('8 PM');
  });

  it('loads the auto-continue setting', async () => {
    vi.mocked(settingsApi.get).mockResolvedValueOnce({
      data: { claudeAutoContinue: true }
    } as never);
    const popup = useClaudeLimitPopup();
    await popup.loadClaudeAutoContinueSetting();
    expect(popup.bClaudeAutoContinueEnabled.value).toBe(true);

    popup.handleAutoContinueUpdated(false);
    expect(popup.bClaudeAutoContinueEnabled.value).toBe(false);
  });

  it('keeps the default when the setting is missing or the load fails', async () => {
    vi.mocked(settingsApi.get).mockResolvedValueOnce({ data: {} } as never);
    const popup = useClaudeLimitPopup();
    await popup.loadClaudeAutoContinueSetting();
    expect(popup.bClaudeAutoContinueEnabled.value).toBe(false);

    vi.mocked(settingsApi.get).mockRejectedValueOnce(new Error('network'));
    await popup.loadClaudeAutoContinueSetting();
    expect(popup.bClaudeAutoContinueEnabled.value).toBe(false);
  });
});
