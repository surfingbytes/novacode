// node_modules
import { Type, type Static } from '@sinclair/typebox';

const NullableNumber = Type.Union([Type.Number(), Type.Null()]);
const NullableString = Type.Union([Type.String(), Type.Null()]);

// ---------------------------------- Usage overview ----------------------------------
export const UsageOverviewQuerySchema = Type.Object({
  /** ISO timestamp; defaults to `to` minus 30 days. */
  from: Type.Optional(Type.String()),
  /** ISO timestamp; defaults to now. */
  to: Type.Optional(Type.String())
});
export type UsageOverviewQuery = Static<typeof UsageOverviewQuerySchema>;

export const UsageOverviewSchema = Type.Object({
  from: Type.String(),
  to: Type.String(),
  totals: Type.Object({
    turnCount: Type.Number(),
    used: Type.Number(),
    costAmount: NullableNumber,
    costCurrency: NullableString
  }),
  byWorkspace: Type.Array(
    Type.Object({
      workspaceId: Type.String(),
      workspaceName: Type.String(),
      turnCount: Type.Number(),
      used: Type.Number(),
      costAmount: NullableNumber
    })
  ),
  byAgentType: Type.Array(
    Type.Object({
      agentType: Type.String(),
      turnCount: Type.Number(),
      used: Type.Number(),
      costAmount: NullableNumber
    })
  ),
  byModel: Type.Array(
    Type.Object({
      agentType: Type.String(),
      model: Type.String(),
      turnCount: Type.Number(),
      used: Type.Number(),
      costAmount: NullableNumber
    })
  ),
  byDay: Type.Array(
    Type.Object({
      /** UTC day, YYYY-MM-DD. */
      date: Type.String(),
      turnCount: Type.Number(),
      used: Type.Number(),
      costAmount: NullableNumber
    })
  )
});
export type UsageOverview = Static<typeof UsageOverviewSchema>;
