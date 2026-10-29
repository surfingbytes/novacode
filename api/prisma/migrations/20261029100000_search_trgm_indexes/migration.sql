-- Trigram indexes for global search (searchCatalog runs ILIKE '%q%').
-- Queries shorter than 3 characters cannot use them and fall back to a sequential scan.
-- schema.prisma mirrors these indexes (type: Gin, ops: raw("gin_trgm_ops")); the extension itself
-- is not declared there (postgresqlExtensions preview feature is off), so Prisma ignores it in diffs.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_session_messages_content_trgm" ON "session_messages" USING GIN ("content" gin_trgm_ops);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_session_messages_search_text_trgm" ON "session_messages" USING GIN ("search_text" gin_trgm_ops);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_sessions_name_trgm" ON "sessions" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_sessions_last_preview_trgm" ON "sessions" USING GIN ("last_preview_text" gin_trgm_ops);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_orchestrators_name_trgm" ON "orchestrators" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_workspaces_name_trgm" ON "workspaces" USING GIN ("name" gin_trgm_ops);
