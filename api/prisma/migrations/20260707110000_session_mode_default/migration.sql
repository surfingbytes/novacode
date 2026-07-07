-- Rename mode sentinel from legacy `auto` to `default` (do not confuse with model `auto`).
UPDATE "sessions" SET "session_mode" = 'default' WHERE "session_mode" = 'auto';

ALTER TABLE "sessions" ALTER COLUMN "session_mode" SET DEFAULT 'default';
