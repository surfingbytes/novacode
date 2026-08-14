-- CreateTable
CREATE TABLE "session_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "events_json" TEXT,
    "image_paths_json" TEXT,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "session_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "session_messages_session_id_position_key" ON "session_messages"("session_id", "position");

-- CreateIndex
CREATE INDEX "idx_session_messages_session_id" ON "session_messages"("session_id");

-- AddForeignKey
ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trigram index for ILIKE search on message content
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "idx_session_messages_content_trgm" ON "session_messages" USING gin ("content" gin_trgm_ops);

-- Backfill from the legacy sessions.message_json blob
DO $$
DECLARE
  rec RECORD;
  elem JSONB;
  idx INT;
BEGIN
  FOR rec IN
    SELECT id, message_json, created_at
    FROM sessions
    WHERE message_json IS NOT NULL
      AND message_json <> ''
      AND message_json <> '[]'
  LOOP
    BEGIN
      idx := 0;
      FOR elem IN SELECT value FROM jsonb_array_elements(rec.message_json::jsonb)
      LOOP
        INSERT INTO session_messages (
          id,
          session_id,
          position,
          role,
          content,
          events_json,
          image_paths_json,
          created_at
        )
        VALUES (
          gen_random_uuid()::text,
          rec.id,
          idx,
          COALESCE(NULLIF(elem->>'role', ''), 'assistant'),
          COALESCE(elem->>'content', ''),
          CASE
            WHEN jsonb_typeof(elem->'events') = 'array' THEN (elem->'events')::text
            ELSE NULL
          END,
          CASE
            WHEN jsonb_typeof(elem->'imagePaths') = 'array' THEN (elem->'imagePaths')::text
            ELSE NULL
          END,
          COALESCE(NULLIF(elem->>'createdAt', ''), rec.created_at)
        );
        idx := idx + 1;
      END LOOP;
    EXCEPTION WHEN others THEN
      -- Skip sessions whose message_json is not a JSON array
      NULL;
    END;
  END LOOP;
END $$;

-- AlterTable
ALTER TABLE "sessions" DROP COLUMN "message_json";
