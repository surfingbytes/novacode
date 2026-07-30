-- Nova-owned chat approval policy: ask (prompt user) or allow_all (auto-select allow).
ALTER TABLE "sessions"
ADD COLUMN "approval_policy" TEXT NOT NULL DEFAULT 'ask';
