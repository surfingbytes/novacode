-- Add Claude auto-continue preference to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "claude_auto_continue" boolean NOT NULL DEFAULT false;

-- Add Claude limit reset time to sessions table  
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "claude_limit_reset_at" text;