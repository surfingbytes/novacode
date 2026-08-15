#!/bin/bash
set -e
# When ./config is mounted and was created by Docker, it is root-owned. Chown it
# to the host user so files created here match your uid/gid.
uid="${UID:-1000}"
gid="${GID:-1000}"
STATUS_FILE="${STARTUP_STATUS_FILE:-/tmp/novacode-startup.json}"
READY_FILE="${STARTUP_READY_FILE:-/tmp/novacode-ready}"
STARTUP_PAGE="${STARTUP_PAGE:-/startup-page.mjs}"

log() {
  echo "[entrypoint $(date +%T)] $*"
}

write_status() {
  local step="$1"
  local detail="$2"
  local progress="$3"
  detail="${detail//\\/\\\\}"
  detail="${detail//\"/\\\"}"
  printf '{"status":"starting","step":"%s","detail":"%s","progress":%s}\n' \
    "$step" "$detail" "$progress" > "$STATUS_FILE"
}

rm -f "$READY_FILE"
write_status "boot" "Starting Nova Code…" 5

# Bind the published port immediately so nginx can serve a progress page
# instead of 502 while the rest of this script (and Node import) runs.
if [ -f "$STARTUP_PAGE" ]; then
  node "$STARTUP_PAGE" &
  log "startup page listening"
else
  log "startup page missing at $STARTUP_PAGE — nginx may 502 until the API binds"
fi

write_status "config" "Preparing config volume…" 20
if [ -d /config ]; then
  config_uid="$(stat -c %u /config 2>/dev/null || echo 0)"
  if [ "${NOVACODE_CHOWN_CONFIG:-}" = "1" ] || [ "$config_uid" != "$uid" ]; then
    log "chown /config ($config_uid -> $uid:$gid)"
    chown -R "${uid}:${gid}" /config
  else
    log "skip chown /config (already uid $uid)"
  fi
fi

write_status "agents" "Checking agent tools…" 40
# Image build already makes /root/.local world-readable. Only fix older images.
if [ -d /root/.local ]; then
  if ! gosu "${uid}:${gid}" test -x /root || ! gosu "${uid}:${gid}" test -r /root/.local; then
    log "making /root/.local readable for uid $uid"
    chmod a+x /root
    chmod -R a+rX /root/.local
  fi
fi

if [ ! -x /root/.local/bin/cursor-agent ]; then
  echo "error: /root/.local/bin/cursor-agent missing or not executable" >&2
  write_status "agents" "cursor-agent is missing or not executable" 40
  sleep 8
  exit 1
fi
if [ "${NOVACODE_VERIFY_CURSOR_AGENT:-}" = "1" ]; then
  result=$(gosu "${uid}:${gid}" /root/.local/bin/cursor-agent --version)
  echo "cursor-agent version: $result"
else
  log "skip cursor-agent --version (set NOVACODE_VERIFY_CURSOR_AGENT=1 to run)"
fi

export PATH="/root/.local/bin:$PATH"

write_status "database" "Applying database migrations…" 70
if [ -x /app/node_modules/.bin/prisma ]; then
  PRISMA_BIN=/app/node_modules/.bin/prisma
elif [ -x node_modules/.bin/prisma ]; then
  PRISMA_BIN=node_modules/.bin/prisma
else
  PRISMA_BIN=""
fi

if [ -f /app/prisma.config.ts ]; then
  PRISMA_CWD=/app
elif [ -f /app/api/prisma.config.ts ]; then
  PRISMA_CWD=/app/api
else
  PRISMA_CWD=.
fi

if [ -n "$PRISMA_BIN" ]; then
  if ! (cd "$PRISMA_CWD" && "$PRISMA_BIN" migrate deploy); then
    write_status "database" "Database migration failed" 70
    sleep 8
    exit 1
  fi
else
  log "prisma binary not found — falling back to npx"
  if ! (cd "$PRISMA_CWD" && npx prisma migrate deploy); then
    write_status "database" "Database migration failed" 70
    sleep 8
    exit 1
  fi
fi

write_status "api" "Starting API…" 90
log "handing off to API"

exec gosu "${uid}:${gid}" "$@"
