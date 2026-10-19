-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN "forge_repo" TEXT;

-- AlterTable
ALTER TABLE "push_subscriptions" ADD COLUMN "notify_tasks" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notify_ci" BOOLEAN NOT NULL DEFAULT false;
