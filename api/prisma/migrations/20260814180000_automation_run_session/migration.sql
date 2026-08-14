-- AlterTable
ALTER TABLE "automations" ADD COLUMN "last_run_status" TEXT;
ALTER TABLE "automations" ADD COLUMN "last_run_error" TEXT;

-- AlterTable
ALTER TABLE "automation_runs" ADD COLUMN "session_id" TEXT;
