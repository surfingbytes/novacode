-- Agent/model for automatic commit messages and session titles
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "utility_agent_type" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "utility_model_selection" text NOT NULL DEFAULT '';
