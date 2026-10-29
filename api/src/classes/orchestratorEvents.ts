// classes
import { db } from './database';
import { broadcastOrchestratorUpsert } from './wsBroadcast';

export { broadcastOrchestratorUpsert };

/** Persist an orchestrator patch and push it to subscribed dashboards (no polling needed). */
export async function updateOrchestratorAndBroadcast(
  workspaceId: string,
  orchestratorId: string,
  patch: Parameters<typeof db.updateOrchestrator>[1]
): Promise<Awaited<ReturnType<typeof db.updateOrchestrator>>> {
  const updated = await db.updateOrchestrator(orchestratorId, patch);
  if (updated) {
    broadcastOrchestratorUpsert(workspaceId, updated);
  }
  return updated;
}
