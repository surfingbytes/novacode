#!/usr/bin/env bash
# Nova Code one-line installer / updater (install vs update is detected automatically).
#
#   curl -fsSL https://raw.githubusercontent.com/surfingbytes/novacode/main/scripts/install.sh | bash
#
# If ~/.novacode/.env exists → updates (refetch compose, pull images, recreate). Otherwise → fresh install.
#
# Override the raw GitHub base for fetched files (repo root: contains scripts/ and .env.example):
#   export NOVACODE_INSTALL_BASE_URL="https://raw.githubusercontent.com/surfingbytes/novacode/main"
#
set -euo pipefail

NOVACODE_DIR="${NOVACODE_DIR:-${HOME}/.novacode}"
NOVACODE_CONFIG="${NOVACODE_DIR}/config"
NOVACODE_POSTGRES_DATA="${NOVACODE_DIR}/postgres-data"

# Published image (override in .env as NOVACODE_IMAGE).
NOVACODE_IMAGE_DEFAULT="${NOVACODE_IMAGE:-ghcr.io/surfingbytes/novacode:latest}"

# Base URL for fetching docker-compose.install.yml (no trailing slash).
NOVACODE_INSTALL_BASE_URL="${NOVACODE_INSTALL_BASE_URL:-https://raw.githubusercontent.com/surfingbytes/novacode/main}"

COMPOSE_REL_PATH="scripts/docker-compose.install.yml"
COMPOSE_FETCH_URL="${NOVACODE_INSTALL_BASE_URL}/${COMPOSE_REL_PATH}"

ENV_EXAMPLE_REL_PATH=".env.example"
ENV_EXAMPLE_FETCH_URL="${NOVACODE_INSTALL_BASE_URL}/${ENV_EXAMPLE_REL_PATH}"

DOCKER_DOC_URL="https://docs.docker.com/engine/install/"
COMPOSE_DOC_URL="https://docs.docker.com/compose/install/"

die() {
  echo "error: $*" >&2
  exit 1
}

ensure_writable_install_root() {
  if [[ -e "$NOVACODE_DIR" ]]; then
    if [[ ! -d "$NOVACODE_DIR" ]]; then
      die "${NOVACODE_DIR} exists but is not a directory"
    fi
    if [[ ! -w "$NOVACODE_DIR" ]]; then
      die "cannot write to ${NOVACODE_DIR} — fix ownership (e.g. sudo chown -R \"$(id -un):$(id -gn)\" \"${NOVACODE_DIR}\")"
    fi
  else
    local parent
    parent="$(dirname "$NOVACODE_DIR")"
    if [[ ! -d "$parent" ]] || [[ ! -w "$parent" ]]; then
      die "cannot create ${NOVACODE_DIR}: parent directory ${parent} is missing or not writable"
    fi
    mkdir -p "$NOVACODE_DIR" || die "cannot create ${NOVACODE_DIR}"
  fi
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is not installed." >&2
    echo "Install Docker: ${DOCKER_DOC_URL}" >&2
    exit 1
  fi
  if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE=(docker-compose)
  else
    echo "Docker Compose is not available (need 'docker compose' or 'docker-compose')." >&2
    echo "Install Compose: ${COMPOSE_DOC_URL}" >&2
    exit 1
  fi
}

expand_path() {
  local p="$1"
  if [[ "$p" == ~ ]]; then
    echo "${HOME}"
    return
  fi
  if [[ "$p" == ~/* ]]; then
    p="${HOME}/${p#~/}"
  fi
  if command -v realpath >/dev/null 2>&1; then
    realpath -m "$p" 2>/dev/null || echo "$p"
  else
    echo "$p"
  fi
}


fetch_compose() {
  local dest="$1"
  if command -v curl >/dev/null 2>&1; then
    if curl -fsSL "$COMPOSE_FETCH_URL" -o "$dest"; then
      return 0
    fi
  fi
  return 1
}

write_compose() {
  local dest="${NOVACODE_DIR}/docker-compose.yml"
  if fetch_compose "$dest"; then
    echo "Fetched docker-compose from ${COMPOSE_FETCH_URL}"
  else
    echo "Could not fetch compose (curl missing or URL unreachable). Stopping installation." >&2
    exit 1
  fi
}

hash_file_md5() {
  local file="$1"
  if command -v md5sum >/dev/null 2>&1; then
    md5sum "$file" | sed 's/[[:space:]].*$//'
    return 0
  fi
  if command -v md5 >/dev/null 2>&1; then
    md5 -q "$file"
    return 0
  fi
  # Fallback: use OpenSSL even if md5sum/md5 aren't present.
  openssl dgst -md5 "$file" | sed 's/^.*= //'
}

fetch_env_example_md5() {
  # Returns md5 of published .env.example, or non-zero if unavailable.
  command -v curl >/dev/null 2>&1 || return 1

  local tmp
  tmp="$(mktemp)"
  if curl -fsSL "$ENV_EXAMPLE_FETCH_URL" -o "$tmp"; then
    hash_file_md5 "$tmp"
    rm -f "$tmp" || true
    return 0
  fi
  rm -f "$tmp" || true
  return 1
}

get_installed_env_example_md5() {
  local f="${NOVACODE_DIR}/.env"
  [[ -f "$f" ]] || return 0
  sed -n 's/^NOVACODE_ENV_EXAMPLE_MD5=//p' "$f" | sed -n '1p'
}

env_has_key() {
  local key="$1"
  [[ -f "${NOVACODE_DIR}/.env" ]] || return 1
  grep -q "^${key}=" "${NOVACODE_DIR}/.env" 2>/dev/null
}

ensure_env_paths() {
  local f="${NOVACODE_DIR}/.env"
  [[ -f "$f" ]] || return 0
  if ! grep -q '^NOVACODE_CONFIG_DIR=' "$f" 2>/dev/null; then
    echo "NOVACODE_CONFIG_DIR=${NOVACODE_CONFIG}" >>"$f"
  fi
  if ! grep -q '^NOVACODE_POSTGRES_DATA_DIR=' "$f" 2>/dev/null; then
    echo "NOVACODE_POSTGRES_DATA_DIR=${NOVACODE_POSTGRES_DATA}" >>"$f"
  fi
  if ! grep -q '^COMPOSE_PROJECT_NAME=' "$f" 2>/dev/null; then
    echo "COMPOSE_PROJECT_NAME=novacode" >>"$f"
  fi
  if ! grep -q '^POSTGRES_PUBLISH_PORT=' "$f" 2>/dev/null; then
    echo "POSTGRES_PUBLISH_PORT=5432" >>"$f"
  fi
}

write_env_file() {
  local env_example_md5="${1:-}"
  command -v openssl >/dev/null 2>&1 || die "openssl is required to generate JWT and database passwords"
  local pg_pass jwt
  pg_pass="$(openssl rand -hex 24)"
  jwt="$(openssl rand -hex 32)"
  ( umask 077; cat >"${NOVACODE_DIR}/.env" <<EOF
# Generated by scripts/install.sh — keep private.
COMPOSE_PROJECT_NAME=novacode

NOVACODE_IMAGE=${NOVACODE_IMAGE_DEFAULT}
NOVACODE_CONFIG_DIR=${NOVACODE_CONFIG}
NOVACODE_POSTGRES_DATA_DIR=${NOVACODE_POSTGRES_DATA}
NOVACODE_ENV_EXAMPLE_MD5=${env_example_md5}

POSTGRES_USER=postgres
POSTGRES_PASSWORD=${pg_pass}
POSTGRES_DB=novacode
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_PUBLISH_PORT=5432

JWT_SECRET=${jwt}

PORT=3030

UID=$(id -u)
GID=$(id -g)
EOF
  )
  chmod 600 "${NOVACODE_DIR}/.env"
  echo "Wrote ${NOVACODE_DIR}/.env (secrets generated)."
}

prompt_extra_volumes() {
  if [[ ! -r /dev/tty ]]; then
    echo "No terminal available: skipping extra volume prompts. Add ${NOVACODE_DIR}/docker-compose.override.yml manually if needed."
    return 0
  fi
  local override="${NOVACODE_DIR}/docker-compose.override.yml"
  rm -f "$override"
  local lines=()
  echo
  echo "Optional: mount host directories into the container (for workspaces under /data-root/...)."
  echo "Press Enter with empty host path when done."
  while true; do
    local host_path cpath suggest
    read -r -p "Host directory to mount (absolute path, or empty to finish): " host_path < /dev/tty || true
    host_path="$(echo "$host_path" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    if [[ -z "$host_path" ]]; then
      break
    fi
    host_path="$(expand_path "$host_path")"
    if [[ ! -d "$host_path" ]]; then
      read -r -p "Directory does not exist: $host_path — create it? [y/N] " mk < /dev/tty || true
      if [[ "${mk:-}" =~ ^[yY]$ ]]; then
        mkdir -p "$host_path" || die "could not create $host_path"
      else
        echo "Skipped."
        continue
      fi
    fi
    suggest="/data-root/$(basename "$host_path")"
    read -r -p "Container path [${suggest}]: " cpath < /dev/tty || true
    cpath="$(echo "${cpath:-$suggest}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    lines+=("      - ${host_path}:${cpath}")
  done
  if [[ ${#lines[@]} -gt 0 ]]; then
    {
      echo "services:"
      echo "  novacode:"
      echo "    volumes:"
      printf '%s\n' "${lines[@]}"
    } >"$override"
    chmod 644 "$override"
    echo "Wrote ${override}"
  else
    echo "No extra volume mounts."
  fi
}

compose_cmd() {
  (cd "$NOVACODE_DIR" && "${DOCKER_COMPOSE[@]}" "$@")
}

is_installed() {
  [[ -f "${NOVACODE_DIR}/.env" ]]
}

cmd_run() {
  require_docker
  ensure_writable_install_root
  mkdir -p "$NOVACODE_CONFIG" "$NOVACODE_POSTGRES_DATA"

  if is_installed; then
    echo "Existing installation at ${NOVACODE_DIR} — updating."
    local fetched_env_md5 installed_env_md5 regen_secrets=0

    # If required secrets are missing, we must regenerate.
    env_has_key "JWT_SECRET" || regen_secrets=1
    env_has_key "POSTGRES_PASSWORD" || regen_secrets=1
    env_has_key "POSTGRES_DB" || regen_secrets=1

    # Otherwise, regenerate only if published .env.example changed.
    fetched_env_md5="$(fetch_env_example_md5 || true)"
    installed_env_md5="$(get_installed_env_example_md5 || true)"

    if [[ "$regen_secrets" -eq 0 && -n "$fetched_env_md5" ]]; then
      if [[ -n "$installed_env_md5" ]]; then
        [[ "$fetched_env_md5" != "$installed_env_md5" ]] && regen_secrets=1
      else
        # No marker yet: record baseline without rotating secrets.
        echo "NOVACODE_ENV_EXAMPLE_MD5=${fetched_env_md5}" >>"${NOVACODE_DIR}/.env" || true
      fi
    fi

    if [[ "$regen_secrets" -eq 1 ]]; then
      local backup ts
      ts="$(date +%Y%m%d%H%M%S)"
      backup="${NOVACODE_DIR}/.env.bak.${ts}"
      cp -a "${NOVACODE_DIR}/.env" "$backup"
      echo "Backed up .env to ${backup}"
      write_env_file "$fetched_env_md5"
    fi

    ensure_env_paths
    write_compose
    # shellcheck disable=SC1090
    set -a && source "${NOVACODE_DIR}/.env" && set +a
    mkdir -p "${NOVACODE_CONFIG_DIR:-$NOVACODE_CONFIG}" "${NOVACODE_POSTGRES_DATA_DIR:-$NOVACODE_POSTGRES_DATA}"

    compose_cmd pull
    compose_cmd up -d --remove-orphans --force-recreate
    echo
    echo "Update complete. docker-compose.override.yml (if any) was kept."
    echo "Open: http://localhost:${PORT:-3030}"
    return
  fi

  echo "Installing Nova Code under ${NOVACODE_DIR}..."
  write_compose
  # Best-effort: store current published .env.example hash for future updates.
  write_env_file "$(fetch_env_example_md5 || true)"
  # shellcheck disable=SC1090
  set -a && source "${NOVACODE_DIR}/.env" && set +a
  prompt_extra_volumes
  compose_cmd pull
  compose_cmd up -d --remove-orphans
  echo
  echo "Nova Code is starting under ${NOVACODE_DIR}"
  echo "  Config:  ${NOVACODE_CONFIG}"
  echo "  Postgres data: ${NOVACODE_POSTGRES_DATA}"
  echo "  Open:    http://localhost:${PORT:-3030}"
  echo "Manage: cd ${NOVACODE_DIR} && ${DOCKER_COMPOSE[*]} logs -f"
  echo "Re-run this script anytime to update."
}

usage() {
  cat <<EOF
Usage: $(basename "$0") [-h|--help]

  Installs under ${NOVACODE_DIR} when no .env exists there; otherwise updates (same command).

Environment:
  NOVACODE_DIR              Install root (default: ~/.novacode)
  NOVACODE_IMAGE            Default image if not in .env (default: ghcr.io/surfingbytes/novacode:latest)
  NOVACODE_INSTALL_BASE_URL Base URL for ${COMPOSE_REL_PATH} (default: ${NOVACODE_INSTALL_BASE_URL})
EOF
}

main() {
  case "${1:-}" in
    -h|--help|help) usage ;;
    ""|install|update) cmd_run ;;
    *) die "unknown argument: $1 (use -h for help)" ;;
  esac
}

main "$@"
