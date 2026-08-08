-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN "is_favorite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "workspaces" ADD COLUMN "favorite_order" INTEGER;
