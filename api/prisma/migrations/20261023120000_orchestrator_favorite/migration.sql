-- AlterTable
ALTER TABLE "orchestrators" ADD COLUMN "is_favorite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "orchestrators" ADD COLUMN "unread" BOOLEAN NOT NULL DEFAULT false;
