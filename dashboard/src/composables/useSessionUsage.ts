/**
 * Session usage — per-turn usage, the header cost label and the pooled account remaining.
 * Extracted from SessionChat.vue.
 */

// node_modules
import { computed, ref, watch, type Ref } from 'vue';

// classes
import { agentAuthApi, sessionsApi } from '@/classes/api';
import { formatSessionCostLabel, resolveSessionCostAmount } from '@/utils/sessionUsageDisplay';
import { formatRemainingLabel } from '@/utils/cursorUsageDisplay';

// types
import type { Session, SessionUsageSummary, SessionUsageTurn } from '@/@types/index';
import type { StreamUsage } from '@/utils/chatDisplayItems';

// -------------------------------------------------- Types --------------------------------------------------

export interface UseSessionUsageOptions {
  workspaceId: () => string;
  sessionId: () => string;
  /** Seeds the usage footer from the session's last persisted usage while idle. */
  session: Ref<Session | null>;
  streamingUsage: Ref<StreamUsage | null>;
  bIsStreaming: Ref<boolean>;
}

export function useSessionUsage(options: UseSessionUsageOptions) {
  const { session, streamingUsage, bIsStreaming } = options;

  // -------------------------------------------------- Refs --------------------------------------------------
  const usageTurns = ref<SessionUsageTurn[]>([]);
  const usageSummary = ref<SessionUsageSummary | null>(null);
  const pooledRemainingCents = ref<number | null>(null);

  // -------------------------------------------------- Computed --------------------------------------------------
  const sessionCostLabel = computed(() => {
    const amount = resolveSessionCostAmount({
      persistedAmount: usageSummary.value?.costAmount,
      liveAmount: streamingUsage.value?.cost?.amount,
      bStreaming: bIsStreaming.value
    });
    if (amount == null) {
      return null;
    }
    return formatSessionCostLabel(
      amount,
      streamingUsage.value?.cost?.currency ?? usageSummary.value?.costCurrency
    );
  });
  /** Account remaining — used when ACP does not report per-session cost (typical for Cursor). */
  const pooledRemainingLabel = computed(() => {
    if (sessionCostLabel.value != null) return null;
    if (pooledRemainingCents.value == null) return null;
    return formatRemainingLabel(pooledRemainingCents.value);
  });

  // -------------------------------------------------- Methods --------------------------------------------------
  async function fetchUsageTurns(): Promise<void> {
    try {
      const response = await sessionsApi.listUsage(options.workspaceId(), options.sessionId());
      usageTurns.value = response.data.turns;
      usageSummary.value = response.data.summary ?? null;
      const latest = usageTurns.value[0];
      if (latest && !bIsStreaming.value && streamingUsage.value == null) {
        streamingUsage.value = latest;
      }
    } catch {
      // Usage is optional; agents that never emit usage_update leave this empty.
    }
  }

  async function loadPooledRemaining(): Promise<void> {
    try {
      const { data } = await agentAuthApi.cursorUsage();
      const remaining = data.available ? data.individual?.remainingCents : null;
      pooledRemainingCents.value = remaining ?? null;
    } catch {
      pooledRemainingCents.value = null;
    }
  }

  /** Clears per-session usage (the chat switched to another session). */
  function resetUsage(): void {
    usageTurns.value = [];
    usageSummary.value = null;
  }

  // -------------------------------------------------- Watchers --------------------------------------------------
  watch(
    () => session.value?.lastUsage,
    (usage) => {
      if (usage && !bIsStreaming.value && streamingUsage.value == null) {
        streamingUsage.value = usage;
      }
    },
    { immediate: true }
  );

  return {
    // data
    usageTurns,
    usageSummary,
    sessionCostLabel,
    pooledRemainingLabel,
    // methods
    fetchUsageTurns,
    loadPooledRemaining,
    resetUsage
  };
}
