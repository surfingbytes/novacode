// node_modules
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

vi.mock('@/classes/api', () => ({
  sessionsApi: { listUsage: vi.fn() },
  agentAuthApi: { claudeUsage: vi.fn(), cursorUsage: vi.fn() }
}));

// classes
import { sessionsApi } from '@/classes/api';

// composables
import { useSessionUsage } from '@/composables/useSessionUsage';

// types
import type { Session } from '@/@types/index';
import type { StreamUsage } from '@/utils/chatDisplayItems';

describe('useSessionUsage', () => {
  it('drops a usage reply for a session the chat already left', async () => {
    let finish: (value: unknown) => void = () => undefined;
    vi.mocked(sessionsApi.listUsage).mockReturnValueOnce(
      new Promise((resolve) => (finish = resolve)) as never
    );
    let sessionId = 's1';
    const streamingUsage = ref<StreamUsage | null>(null);
    const usage = useSessionUsage({
      workspaceId: () => 'w1',
      sessionId: () => sessionId,
      session: ref<Session | null>(null),
      streamingUsage,
      bIsStreaming: ref(false)
    });

    const pending = usage.fetchUsageTurns();
    sessionId = 's2';
    usage.resetUsage();
    finish({
      data: {
        turns: [{ inputTokens: 1 }],
        summary: { costAmount: 5, costCurrency: 'USD' }
      }
    });
    await pending;

    expect(usage.usageTurns.value).toEqual([]);
    expect(usage.usageSummary.value).toBeNull();
    expect(streamingUsage.value).toBeNull();
  });
});
