-- CreateIndex
CREATE INDEX "idx_sessions_workspace_archived_updated" ON "sessions"("workspaceId", "archived", "updated_at" DESC);
