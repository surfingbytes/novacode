-- Persist chat unread so read/unread syncs across devices.
ALTER TABLE "sessions" ADD COLUMN "unread" BOOLEAN NOT NULL DEFAULT false;
