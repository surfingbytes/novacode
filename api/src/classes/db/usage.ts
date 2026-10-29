// classes
import { prisma } from './client';

// types
import type { UsageOverview } from '../../@types/index';

// --------------------------------------------- Usage overview ---------------------------------------------

export type UsageOverviewRow = {
  workspaceId: string;
  used: number;
  size: number;
  costAmount: number | null;
  costCurrency: string | null;
  createdAt: string;
  session: { agentType: string; modelSelection: string };
};

type UsageGroupTotals = { turnCount: number; used: number; costAmount: number | null };

const DELETED_WORKSPACE_NAME = '(deleted)';

function emptyTotals(): UsageGroupTotals {
  return { turnCount: 0, used: 0, costAmount: null };
}

function addRow(totals: UsageGroupTotals, row: UsageOverviewRow): void {
  totals.turnCount += 1;
  totals.used += row.used;
  if (row.costAmount !== null) {
    totals.costAmount = (totals.costAmount ?? 0) + row.costAmount;
  }
}

function addToGroup<T extends UsageGroupTotals>(
  groups: Map<string, T>,
  key: string,
  row: UsageOverviewRow,
  create: () => T
): void {
  let group = groups.get(key);
  if (!group) {
    group = create();
    groups.set(key, group);
  }
  addRow(group, row);
}

/** Cost desc (null last), then used desc. */
function compareGroups(left: UsageGroupTotals, right: UsageGroupTotals): number {
  if (left.costAmount !== right.costAmount) {
    if (left.costAmount === null) {
      return 1;
    }
    if (right.costAmount === null) {
      return -1;
    }
    return right.costAmount - left.costAmount;
  }
  return right.used - left.used;
}

function mostCommonCurrency(rows: UsageOverviewRow[]): string | null {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.costCurrency) {
      counts.set(row.costCurrency, (counts.get(row.costCurrency) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [currency, count] of counts) {
    if (count > bestCount) {
      best = currency;
      bestCount = count;
    }
  }
  return best;
}

/** Pure aggregation of usage rows into the overview shape (exported for tests). */
export function aggregateUsageOverview(
  rows: UsageOverviewRow[],
  workspaceNames: Map<string, string>,
  fromIso: string,
  toIso: string
): UsageOverview {
  const totals = emptyTotals();
  const byWorkspace = new Map<string, UsageGroupTotals & { workspaceId: string; workspaceName: string }>();
  const byAgentType = new Map<string, UsageGroupTotals & { agentType: string }>();
  const byModel = new Map<string, UsageGroupTotals & { agentType: string; model: string }>();
  const byDay = new Map<string, UsageGroupTotals & { date: string }>();

  for (const row of rows) {
    const { agentType, modelSelection } = row.session;
    const date = row.createdAt.slice(0, 10);
    addRow(totals, row);
    addToGroup(byWorkspace, row.workspaceId, row, () => ({
      workspaceId: row.workspaceId,
      workspaceName: workspaceNames.get(row.workspaceId) ?? DELETED_WORKSPACE_NAME,
      ...emptyTotals()
    }));
    addToGroup(byAgentType, agentType, row, () => ({ agentType, ...emptyTotals() }));
    addToGroup(byModel, JSON.stringify([agentType, modelSelection]), row, () => ({
      agentType,
      model: modelSelection,
      ...emptyTotals()
    }));
    addToGroup(byDay, date, row, () => ({ date, ...emptyTotals() }));
  }

  return {
    from: fromIso,
    to: toIso,
    totals: { ...totals, costCurrency: mostCommonCurrency(rows) },
    byWorkspace: [...byWorkspace.values()].sort(compareGroups),
    byAgentType: [...byAgentType.values()].sort(compareGroups),
    byModel: [...byModel.values()].sort(compareGroups),
    byDay: [...byDay.values()].sort((left, right) => left.date.localeCompare(right.date))
  };
}

async function summarizeUsageOverview(fromIso: string, toIso: string): Promise<UsageOverview> {
  const rows = await prisma.sessionUsage.findMany({
    where: { createdAt: { gte: fromIso, lte: toIso } },
    select: {
      workspaceId: true,
      used: true,
      size: true,
      costAmount: true,
      costCurrency: true,
      createdAt: true,
      session: { select: { agentType: true, modelSelection: true } }
    }
  });
  const workspaceIds = [...new Set(rows.map((row) => row.workspaceId))];
  const workspaces = workspaceIds.length
    ? await prisma.workspace.findMany({ where: { id: { in: workspaceIds } }, select: { id: true, name: true } })
    : [];
  const workspaceNames = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
  return aggregateUsageOverview(rows, workspaceNames, fromIso, toIso);
}

export const usageDb = {
  summarizeUsageOverview
};
