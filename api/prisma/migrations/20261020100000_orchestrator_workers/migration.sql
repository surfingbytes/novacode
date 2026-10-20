-- AlterTable
ALTER TABLE "orchestrators" ADD COLUMN "worker_model" TEXT;
ALTER TABLE "orchestrators" ADD COLUMN "max_parallel" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "orchestrators" ADD COLUMN "run_mode" TEXT;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "worktree_path" TEXT;
