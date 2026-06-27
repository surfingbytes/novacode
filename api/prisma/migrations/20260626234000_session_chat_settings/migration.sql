ALTER TABLE "users" ADD COLUMN "hide_thinking_output" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "sessions" ADD COLUMN "model_selection" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "sessions" ADD COLUMN "hide_thinking_output" BOOLEAN NOT NULL DEFAULT false;
