-- Recreate hashed programmatic API keys (dropped in 20260329120000_remove_api_tokens).
CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "last_used_at" TEXT,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");
CREATE INDEX "idx_api_tokens_user_id" ON "api_tokens"("user_id");

ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Per-turn token/cost snapshots, plus a denormalized last-usage JSON on sessions.
ALTER TABLE "sessions" ADD COLUMN "last_usage_json" TEXT;

CREATE TABLE "session_usage" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "used" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "cost_amount" DOUBLE PRECISION,
    "cost_currency" TEXT,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "session_usage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_session_usage_session_id" ON "session_usage"("session_id");
CREATE INDEX "idx_session_usage_workspace_id" ON "session_usage"("workspace_id");

ALTER TABLE "session_usage" ADD CONSTRAINT "session_usage_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
