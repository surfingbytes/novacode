// node_modules
import { afterEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    sessionUsage: { findMany: vi.fn() },
    workspace: { findMany: vi.fn() }
  }
}));

vi.mock('./client', () => ({ prisma: prismaMock }));

// classes
import { aggregateUsageOverview, usageDb } from './usage';

// types
import type { UsageOverviewRow } from './usage';

function row(overrides: Partial<UsageOverviewRow> & { agentType?: string; model?: string } = {}): UsageOverviewRow {
  const { agentType = 'claude', model = 'auto', ...rest } = overrides;
  return {
    workspaceId: 'w1',
    used: 100,
    size: 1000,
    costAmount: null,
    costCurrency: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    session: { agentType, modelSelection: model },
    ...rest
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('aggregateUsageOverview', () => {
  it('returns empty groups for no rows', () => {
    expect(aggregateUsageOverview([], new Map(), 'a', 'b')).toEqual({
      from: 'a',
      to: 'b',
      totals: { turnCount: 0, used: 0, costAmount: null, costCurrency: null },
      byWorkspace: [],
      byAgentType: [],
      byModel: [],
      byDay: []
    });
  });

  it('groups and sorts by cost desc (null last), then used desc', () => {
    const rows = [
      row({ workspaceId: 'w1', used: 500, agentType: 'codex', model: 'gpt', createdAt: '2026-10-03T23:59:00.000Z' }),
      row({ workspaceId: 'w2', used: 10, costAmount: 1, costCurrency: 'USD', createdAt: '2026-10-01T00:00:00.000Z' }),
      row({ workspaceId: 'w2', used: 20, costAmount: 2, costCurrency: 'USD', model: 'opus' }),
      row({ workspaceId: 'w3', used: 50, costAmount: 0.5, costCurrency: 'EUR', createdAt: '2026-10-02T05:00:00.000Z' }),
      row({ workspaceId: 'w4', used: 900, agentType: 'codex', model: 'gpt', createdAt: '2026-10-02T06:00:00.000Z' })
    ];
    const names = new Map([
      ['w1', 'One'],
      ['w2', 'Two'],
      ['w3', 'Three']
    ]);
    const overview = aggregateUsageOverview(rows, names, 'from', 'to');

    expect(overview.totals).toEqual({ turnCount: 5, used: 1480, costAmount: 3.5, costCurrency: 'USD' });
    expect(overview.byWorkspace).toEqual([
      { workspaceId: 'w2', workspaceName: 'Two', turnCount: 2, used: 30, costAmount: 3 },
      { workspaceId: 'w3', workspaceName: 'Three', turnCount: 1, used: 50, costAmount: 0.5 },
      { workspaceId: 'w4', workspaceName: '(deleted)', turnCount: 1, used: 900, costAmount: null },
      { workspaceId: 'w1', workspaceName: 'One', turnCount: 1, used: 500, costAmount: null }
    ]);
    expect(overview.byAgentType).toEqual([
      { agentType: 'claude', turnCount: 3, used: 80, costAmount: 3.5 },
      { agentType: 'codex', turnCount: 2, used: 1400, costAmount: null }
    ]);
    expect(overview.byModel).toEqual([
      { agentType: 'claude', model: 'opus', turnCount: 1, used: 20, costAmount: 2 },
      { agentType: 'claude', model: 'auto', turnCount: 2, used: 60, costAmount: 1.5 },
      { agentType: 'codex', model: 'gpt', turnCount: 2, used: 1400, costAmount: null }
    ]);
    expect(overview.byDay).toEqual([
      { date: '2026-10-01', turnCount: 2, used: 30, costAmount: 3 },
      { date: '2026-10-02', turnCount: 2, used: 950, costAmount: 0.5 },
      { date: '2026-10-03', turnCount: 1, used: 500, costAmount: null }
    ]);
  });
});

describe('summarizeUsageOverview', () => {
  it('queries the range and resolves workspace names once', async () => {
    prismaMock.sessionUsage.findMany.mockResolvedValue([row({ workspaceId: 'w1' }), row({ workspaceId: 'gone' })]);
    prismaMock.workspace.findMany.mockResolvedValue([{ id: 'w1', name: 'One' }]);

    const overview = await usageDb.summarizeUsageOverview('2026-10-01T00:00:00.000Z', '2026-10-31T00:00:00.000Z');

    expect(prismaMock.sessionUsage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { gte: '2026-10-01T00:00:00.000Z', lte: '2026-10-31T00:00:00.000Z' } }
      })
    );
    expect(prismaMock.workspace.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.workspace.findMany.mock.calls[0][0]).toMatchObject({ where: { id: { in: ['w1', 'gone'] } } });
    expect(overview.byWorkspace.map((group) => group.workspaceName).sort()).toEqual(['(deleted)', 'One']);
  });

  it('skips the workspace lookup when there are no rows', async () => {
    prismaMock.sessionUsage.findMany.mockResolvedValue([]);
    await usageDb.summarizeUsageOverview('a', 'b');
    expect(prismaMock.workspace.findMany).not.toHaveBeenCalled();
  });
});
