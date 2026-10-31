/**
 * Session usage — per-turn usage, the header cost label and the account usage left
 * (Claude subscription windows / Cursor remaining credit).
 * Extracted from SessionChat.vue.
 */

// node_modules
import { computed, ref, watch, type Ref } from 'vue';

// classes
import { agentAuthApi, sessionsApi } from '@/classes/api';
import { formatSessionCostLabel, resolveSessionCostAmount } from '@/utils/sessionUsageDisplay';
import { formatRemainingLabel } from '@/utils/cursorUsageDisplay';
import { formatClaudePlanUsageLabel, formatClaudePlanUsageTitle } from '@/utils/claudePlanUsageDisplay';

// types
import type { ClaudePlanUsage, Session, SessionUsageSummary, SessionUsageTurn } from '@/@types/index';
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
  const claudePlanUsage = ref<ClaudePlanUsage | null>(null);

  // -------------------------------------------------- Computed --------------------------------------------------
  const sessionCostAmount = computed(() =>
    resolveSessionCostAmount({
      persistedAmount: usageSummary.value?.costAmount,
      liveAmount: streamingUsage.value?.cost?.amount,
      bStreaming: bIsStreaming.value
    })
  );
  const sessionCostCurrency = computed(
    () => streamingUsage.value?.cost?.currency ?? usageSummary.value?.costCurrency
  );
  const sessionCostLabel = computed(() =>
    sessionCostAmount.value == null
      ? null
      : formatSessionCostLabel(sessionCostAmount.value, sessionCostCurrency.value)
  );
  /** Full-precision cost for the hover tooltip. */
  const sessionCostTitle = computed(() =>
    sessionCostAmount.value == null
      ? null
      : formatSessionCostLabel(sessionCostAmount.value, sessionCostCurrency.value, 4)
  );
  const agentType = computed(() => session.value?.agentType ?? null);
  /** Subscription usage left — shown before the session cost, which is only API-equivalent there. */
  const accountUsageLabel = computed(() => {
    if (agentType.value === 'claude') {
      return claudePlanUsage.value ? formatClaudePlanUsageLabel(claudePlanUsage.value) : null;
    }
    if (agentType.value === 'cursor-agent' && pooledRemainingCents.value != null) {
      return formatRemainingLabel(pooledRemainingCents.value);
    }
    return null;
  });
  const accountUsageTitle = computed(() => {
    if (agentType.value === 'claude' && claudePlanUsage.value) {
      return formatClaudePlanUsageTitle(claudePlanUsage.value);
    }
    return accountUsageLabel.value;
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

  async function loadClaudePlanUsage(): Promise<void> {
    try {
      const { data } = await agentAuthApi.claudeUsage();
      // A live stream update may have landed while the request was in flight.
      if (data.usage && (!claudePlanUsage.value || data.usage.updatedAt > claudePlanUsage.value.updatedAt)) {
        claudePlanUsage.value = data.usage;
      }
    } catch {
      // Optional: the header just shows the session cost.
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
    agentType,
    (type) => {
      if (type === 'claude') void loadClaudePlanUsage();
      else if (type === 'cursor-agent') void loadPooledRemaining();
    },
    { immediate: true }
  );

  watch(
    () => streamingUsage.value?.planWindows,
    (windows) => {
      if (windows) claudePlanUsage.value = { windows, updatedAt: new Date().toISOString() };
    }
  );

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
    sessionCostTitle,
    accountUsageLabel,
    accountUsageTitle,
    // methods
    fetchUsageTurns,
    resetUsage
  };
}
