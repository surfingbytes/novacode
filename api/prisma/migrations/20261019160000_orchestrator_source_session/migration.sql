-- AlterTable
ALTER TABLE "orchestrators" ADD COLUMN "source_session_id" TEXT;

-- CreateIndex
CREATE INDEX "orchestrators_source_session_id_idx" ON "orchestrators"("source_session_id");
