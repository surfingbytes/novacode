<script setup lang="ts">
// node_modules
import { computed, onMounted, ref, watch } from 'vue';

// components
import PageShell from '@/components/layout/PageShell.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ListPageSkeleton from '@/components/ui/ListPageSkeleton.vue';

// api
import { usageApi } from '@/classes/api';

// stores
import { useToastStore } from '@/stores/toasts';

// types
import type { UsageOverview } from '@/@types/index';

// utils
import { agentTypeLabel } from '@/utils/agentTypeMeta';
import { formatSessionCostLabel } from '@/utils/sessionUsageDisplay';
import { periodRange, toDateInputValue, type UsagePeriodPreset } from '@/utils/usagePeriods';

// -------------------------------------------------- Types --------------------------------------------------

interface UsageTableRow {
  key: string;
  name: string;
  detail?: string;
  to?: string;
  turnCount: number;
  used: number;
  costAmount: number | null;
}

interface UsageTable {
  id: string;
  title: string;
  nameHeader: string;
  rows: UsageTableRow[];
}

// -------------------------------------------------- Constants --------------------------------------------------

const PRESETS: Array<{ id: UsagePeriodPreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'month', label: 'This month' },
  { id: 'custom', label: 'Custom' }
];

const DAY_MS = 24 * 60 * 60 * 1000;

// -------------------------------------------------- Stores --------------------------------------------------

const toastStore = useToastStore();

// -------------------------------------------------- Refs --------------------------------------------------

const preset = ref<UsagePeriodPreset>('30d');
const customFrom = ref(toDateInputValue(new Date(Date.now() - 30 * DAY_MS)));
const customTo = ref(toDateInputValue(new Date()));
const overview = ref<UsageOverview | null>(null);
const bLoading = ref(true);

let requestCounter = 0;

// -------------------------------------------------- Computed --------------------------------------------------

const bCustomRangeValid = computed(
  () => customFrom.value !== '' && customTo.value !== '' && customFrom.value <= customTo.value
);

const bEmpty = computed(() => !overview.value || overview.value.totals.turnCount === 0);

const tables = computed<UsageTable[]>(() => {
  const data = overview.value;
  if (!data) {
    return [];
  }
  return [
    {
      id: 'workspaces',
      title: 'Workspaces',
      nameHeader: 'Workspace',
      rows: data.byWorkspace.map((row) => ({
        key: row.workspaceId,
        name: row.workspaceName,
        to: `/workspace/${row.workspaceId}`,
        turnCount: row.turnCount,
        used: row.used,
        costAmount: row.costAmount
      }))
    },
    {
      id: 'agents',
      title: 'Agents',
      nameHeader: 'Agent',
      rows: data.byAgentType.map((row) => ({
        key: row.agentType,
        name: agentTypeLabel(row.agentType),
        turnCount: row.turnCount,
        used: row.used,
        costAmount: row.costAmount
      }))
    },
    {
      id: 'models',
      title: 'Models',
      nameHeader: 'Model',
      rows: data.byModel.map((row) => ({
        key: `${row.agentType}:${row.model}`,
        name: row.model,
        detail: agentTypeLabel(row.agentType),
        turnCount: row.turnCount,
        used: row.used,
        costAmount: row.costAmount
      }))
    },
    {
      id: 'days',
      title: 'Days',
      nameHeader: 'Date',
      rows: data.byDay.map((row) => ({
        key: row.date,
        name: row.date,
        turnCount: row.turnCount,
        used: row.used,
        costAmount: row.costAmount
      }))
    }
  ];
});

// -------------------------------------------------- Methods --------------------------------------------------

function formatCost(amount: number | null): string {
  if (amount == null) {
    return '—';
  }
  return formatSessionCostLabel(amount, overview.value?.totals.costCurrency);
}

async function fetchOverview(): Promise<void> {
  if (preset.value === 'custom' && !bCustomRangeValid.value) {
    return;
  }
  const range = periodRange(preset.value, new Date(), {
    from: customFrom.value,
    to: customTo.value
  });
  const requestId = ++requestCounter;
  bLoading.value = true;
  try {
    const response = await usageApi.overview(range);
    if (requestId !== requestCounter) {
      return;
    }
    overview.value = response.data;
  } catch {
    if (requestId !== requestCounter) {
      return;
    }
    overview.value = null;
    toastStore.error('Failed to load usage');
  } finally {
    if (requestId === requestCounter) {
      bLoading.value = false;
    }
  }
}

// -------------------------------------------------- Watchers --------------------------------------------------

watch([preset, customFrom, customTo], () => {
  void fetchOverview();
});

// -------------------------------------------------- Lifecycle --------------------------------------------------

onMounted(() => {
  void fetchOverview();
});
</script>

<template>
  <PageShell>
    <PageHeader title="Usage" subtitle="Tokens, turns and cost across all workspaces." />

    <!-- Period -->
    <div class="usage-period">
      <div class="usage-period__presets" role="group" aria-label="Period">
        <button
          v-for="item in PRESETS"
          :key="item.id"
          type="button"
          class="usage-chip"
          :class="{ 'is-active': preset === item.id }"
          :aria-pressed="preset === item.id"
          @click="preset = item.id"
        >
          {{ item.label }}
        </button>
      </div>
      <div v-if="preset === 'custom'" class="usage-period__custom">
        <label class="usage-period__field">
          <span>From</span>
          <input v-model="customFrom" type="date" class="usage-period__input" :max="customTo" />
        </label>
        <label class="usage-period__field">
          <span>To</span>
          <input v-model="customTo" type="date" class="usage-period__input" :min="customFrom" />
        </label>
        <span v-if="!bCustomRangeValid" class="usage-period__error">Pick a valid range</span>
      </div>
    </div>

    <!-- Loading -->
    <ListPageSkeleton v-if="bLoading" variant="rows" :count="6" label="Loading usage" />

    <!-- Empty -->
    <EmptyState v-else-if="bEmpty" icon="clock" title="No usage recorded in this period" />

    <template v-else-if="overview">
      <!-- Totals -->
      <div class="usage-totals">
        <div class="usage-total">
          <div class="usage-total__label">Cost</div>
          <div class="usage-total__value">{{ formatCost(overview.totals.costAmount) }}</div>
        </div>
        <div class="usage-total">
          <div class="usage-total__label">Tokens</div>
          <div class="usage-total__value">{{ overview.totals.used.toLocaleString() }}</div>
        </div>
        <div class="usage-total">
          <div class="usage-total__label">Turns</div>
          <div class="usage-total__value">{{ overview.totals.turnCount.toLocaleString() }}</div>
        </div>
      </div>

      <!-- Tables -->
      <section v-for="table in tables" :key="table.id" class="usage-section">
        <h2 class="usage-section__title">{{ table.title }}</h2>
        <div class="usage-table-wrap">
          <table class="usage-table">
            <thead>
              <tr>
                <th scope="col">{{ table.nameHeader }}</th>
                <th scope="col" class="is-numeric">Turns</th>
                <th scope="col" class="is-numeric">Tokens</th>
                <th scope="col" class="is-numeric">Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in table.rows" :key="row.key">
                <td>
                  <RouterLink v-if="row.to" :to="row.to" class="usage-table__link">
                    {{ row.name }}
                  </RouterLink>
                  <template v-else>{{ row.name }}</template>
                  <span v-if="row.detail" class="usage-table__detail">{{ row.detail }}</span>
                </td>
                <td class="is-numeric">{{ row.turnCount.toLocaleString() }}</td>
                <td class="is-numeric">{{ row.used.toLocaleString() }}</td>
                <td class="is-numeric">{{ formatCost(row.costAmount) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </PageShell>
</template>

<style scoped>
.usage-period {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.usage-period__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.usage-chip {
  padding: 4px 12px;
  font-size: 13px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  color: var(--fg-muted);
  transition:
    background-color 0.15s,
    color 0.15s;
}

.usage-chip:hover {
  background: var(--bg-hover);
}

.usage-chip.is-active {
  border-color: transparent;
  background: var(--accent-soft);
  color: var(--accent);
}

.usage-period__custom {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.usage-period__field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.usage-period__input {
  padding: 3px 8px;
  font-size: 13px;
  border-radius: 6px;
  border: 1px solid var(--line-strong);
  background: transparent;
  color: inherit;
}

.usage-period__error {
  font-size: 12px;
  color: var(--danger);
}

.usage-totals {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.usage-total {
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg-elev);
}

.usage-total__label {
  font-size: 12px;
  color: var(--fg-muted);
}

.usage-total__value {
  margin-top: 2px;
  font-size: 20px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.usage-section {
  margin-bottom: 24px;
}

.usage-section__title {
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
}

.usage-table-wrap {
  overflow-x: auto;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
}

.usage-table {
  width: 100%;
  min-width: 480px;
  border-collapse: collapse;
  font-size: 13px;
}

.usage-table th,
.usage-table td {
  padding: 8px 12px;
  text-align: left;
  white-space: nowrap;
}

.usage-table th {
  font-weight: 500;
  color: var(--fg-muted);
  border-bottom: 1px solid var(--line-strong);
}

.usage-table tbody tr + tr td {
  border-top: 1px solid var(--line);
}

.usage-table .is-numeric {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.usage-table__link {
  color: var(--accent);
}

.usage-table__link:hover {
  text-decoration: underline;
}

.usage-table__detail {
  margin-left: 8px;
  font-size: 12px;
  color: var(--fg-subtle);
}
</style>
