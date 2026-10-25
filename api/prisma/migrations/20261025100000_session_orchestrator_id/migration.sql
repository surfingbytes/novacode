-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "orchestrator_id" TEXT;

-- CreateIndex
CREATE INDEX "sessions_orchestrator_id_idx" ON "sessions"("orchestrator_id");
