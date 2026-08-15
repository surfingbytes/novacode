<div align="center">

# Nova Code

**Self-hosted dashboard for AI coding agents**

Run [Cursor Agent](https://cursor.com), [Claude Code](https://claude.ai/code), [Mistral Vibe](https://mistral.ai), [OpenCode](https://opencode.ai), and [Codex](https://openai.com/codex) against your own repos through a clean web UI — no cloud, no lock-in.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24-green)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue-3-42b883)](https://vuejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791)](https://postgresql.org)

</div>

---

<p align="center">
  <img src="docs/screenshots/workspace-overview.png" alt="Workspace overview" width="90%">
  <br><em>Workspace overview — all your projects and sessions at a glance</em>
</p>

<p align="center">
  <img src="docs/screenshots/session-chat.png" alt="Session chat and terminal" width="90%">
  <br><em>Session view — streaming chat alongside a live terminal</em>
</p>

> **Screenshots are placeholders.** Replace the images in `docs/screenshots/` with real ones before publishing.

---

## Project status

Nova Code was originally created by [Jonah Fintz](https://github.com/JonahFintzDev). The original repository ([`JonahFintzDev/novacode`](https://github.com/JonahFintzDev/novacode)) has been deleted; development continues here at [`surfingbytes/novacode`](https://github.com/surfingbytes/novacode) via Cursor.

---

## Documentation

- **[Current functionality](docs/functions.md)** — inventory of what is implemented (API routes, WebSockets, UI, known limitations).
- **[Remaining improvements](docs/improvement-plan.md)** — open backlog (not a commitment).
- **[API notes](api/README.md)** — role templates, API keys, and usage endpoints.

---

## Features

| | |
|---|---|
| **Home** | Session overview: busy and idle counts, recently active strip, optional compact list; jump to workspaces from there. |
| **Workspaces** | Map any directory on your host to a named project. Group, color-code, tag, and archive. The workspace grid supports a **right-click** menu (open, edit, archive, delete). |
| **Sessions** | Start a **Cursor Agent**, **Claude Code**, **Mistral Vibe**, **OpenCode**, or **Codex** session per workspace. All five talk over ACP. Streaming chat over WebSocket, image attachments, tags, archive, and bulk actions via the sessions list multiselect bar. The in-workspace **Sessions** sidebar shows agent avatars, relative time, and a WhatsApp-style last-message preview (`You: …` for your messages). Session header action buttons use consistent square icon controls (edit/archive/delete). **Right-click** the sidebar, the sessions list, or the grid for open, edit (sessions), archive, and delete. |
| **Global Search** | Quickly find workspaces, sessions, orchestrators, automations, settings, and rule templates. Accessible via the search bar in the top navigation (desktop) or sidebar (mobile). Press `Ctrl+K` to open the search modal from anywhere. Results are grouped by category and include relevant metadata like workspace names for sessions. Session matches include chat body text. |
| **Terminal** | Full PTY-backed terminal output via `node-pty` and xterm.js. |
| **Orchestrators** | Multi-step task plans: decompose a goal into subtasks, run each step in its own session. Edit steps after a run, set **depends on** earlier steps (failed/skipped deps are skipped), **run from step N**, or **clone** a plan. The orchestrator detail header matches session controls (sidebar toggle, workspace subtitle, edit/archive/delete actions). Deleting an orchestrator removes its step sessions too. |
| **Automations** | Schedule recurring agent prompts per workspace (cron-style intervals). |
| **Git** | Per-workspace Git status, diffs, and multi-repo discovery — right in the UI. |
| **File browser** | Browse, create, rename, and delete files and folders inside a workspace. Dotfiles are hidden by default; use the eye toggle to show them. |
| **Workspace rules** | Markdown rule files injected into every agent prompt for that workspace. |
| **Role templates** | Reusable instruction snippets for bootstrapping new rule files. |
| **REST API** | JSON API under `/api`. The dashboard uses an httpOnly session cookie; scripts should use a hashed **API key** from **Account → API keys** (`Authorization: Bearer nck_…`). |
| **Usage** | Token/cost snapshots from ACP `usage_update` events are stored per turn and shown in chat plus a workspace total. |
| **Web Push** | Browser notifications when sessions finish; the body previews the last assistant text or tool result (title still names workspace/session). Notifications include a **Reply** action that opens the PWA directly to that session. VAPID keys are created automatically in the config volume. |
| **Health endpoint** | `GET /api/health` — unauthenticated, ready for Docker `HEALTHCHECK` and uptime monitors. Compose and the image probe this path; Postgres is not published to the host. During container start a progress page binds the port immediately so a reverse proxy does not sit on 502. |
| **MCP connectivity check** | In **Settings → MCP**, **Test connectivity** dry-runs each registered MCP server (stdio spawn, HTTP GET) on the host before agents use them. |

---

## Requirements

- **Docker + Docker Compose** (recommended) — or Node.js 24 + PostgreSQL 17 for a manual install
- **Agent CLIs** — the Docker image includes Cursor Agent, Claude Code, Mistral Vibe, OpenCode, and Codex. Authenticate each agent you use from **Settings → Integrations** (see [Agent setup](#agent-setup)).
- Directories you want to work on must appear under `/data-root` in the container (with the stock compose, that is everything under `~/.novacode/data` on the host, or extra bind mounts you add)

---

## Quick start

### One-line installer (`install.sh`)

For a **published Docker image** under `~/.novacode` (install and updates use the same command):

```bash
curl -fsSL https://raw.githubusercontent.com/surfingbytes/novacode/main/scripts/install.sh | bash
```

**Prerequisites:** Docker with Compose (`docker compose` or `docker-compose`), and `openssl` on first install.

The script writes `~/.novacode/.env` with generated secrets, pulls `ghcr.io/surfingbytes/novacode:latest`, and starts Compose. Re-run the same command to update. Optional environment variables:

| Variable | Purpose |
|----------|---------|
| `NOVACODE_DIR` | Install root (default: `~/.novacode`) |
| `NOVACODE_INSTALL_BASE_URL` | Raw URL of the repo root for fetched compose and `.env.example` (see `scripts/install.sh`) |
| `NOVACODE_IMAGE` | Image tag (default: `ghcr.io/surfingbytes/novacode:latest`) |

On first install you may be prompted for extra host directory mounts (workspaces under `/data-root/...`). Then open **`http://localhost:3030`** and complete **first-run setup**.

### Docker Compose (published image)

```bash
# 1. Clone the application repository
git clone https://github.com/surfingbytes/novacode.git
cd novacode

# 2. Create your env file
cp .env.example .env
#    → Edit .env: set POSTGRES_PASSWORD, JWT_SECRET, and your UID/GID

# 3. By default, ~/.novacode/data on the host is mounted at /data-root — put repos there
#    (mkdir -p ~/.novacode/data) or edit docker-compose.yml to add more bind mounts.

# 4. Pull and start the published image
export UID=$(id -u) GID=$(id -g)
docker compose pull
docker compose up -d

# 5. Open the app and complete first-run setup
#    http://localhost:3030  (or whatever PORT you set)
```

> [!TIP]
> On first launch the app shows a **setup screen** — create your admin account there. No pre-seeding required.

> [!NOTE]
> The `novacode` container includes Cursor Agent, Claude Code, Mistral Vibe, OpenCode, and Codex (Docker build). Log in or paste API keys from **Settings → Integrations → Agent Authentication**.

---

## Configuration

Copy `.env.example` to `.env` and edit the values below.

### Required

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | Password for the PostgreSQL user |
| `JWT_SECRET` | Long random string for signing JWTs — `openssl rand -hex 32` (required at startup; the example placeholder is rejected. Keep stable across restarts/upgrades; changing it invalidates existing browser sessions) |

### PostgreSQL

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | `postgres` | Database user |
| `POSTGRES_DB` | `novacode` | Database name |
| `POSTGRES_HOST` | `postgres` | Hostname — use `postgres` in Docker Compose, or your external DB host |
| `POSTGRES_PORT` | `5432` | Port |
| `DATABASE_URL` | *(unset)* | Optional full connection URL — overrides all `POSTGRES_*` vars when set |

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3030` | HTTP port the API listens on |
| `UID` / `GID` | `1000` | Host user/group for files written inside the container |

### Optional

| Variable | Description |
|----------|-------------|
| `AGENT_ENV_*` | Any env var prefixed with `AGENT_ENV_` is forwarded to spawned agents with the prefix stripped |
| `VIBE_COMMAND` | *(optional)* Executable for Mistral Vibe (default: `vibe` on `PATH`) |
| `VIBE_ACP_COMMAND` | *(optional)* Vibe ACP server binary (default: `vibe-acp`) |
| `OPENCODE_ACP_COMMAND` | *(optional)* OpenCode ACP command (default: `opencode`) |
| `CODEX_ACP_COMMAND` | *(optional)* Codex ACP adapter (default: `codex-acp`) |
| `TRUST_PROXY` | Set to `true` when behind a reverse proxy so login rate limits use `X-Forwarded-For` and session cookies can be marked Secure |
| `CORS_ORIGIN` | Comma-separated browser origins allowed to call the API. Unset: same-origin only in production, any origin in dev. `*` reflects the request Origin |
| `NOVACODE_CHOWN_CONFIG` | Set to `1` to force a recursive `chown` of `/config` on every start (normally skipped when the volume is already owned by `UID`) |
| `NOVACODE_VERIFY_CURSOR_AGENT` | Set to `1` to run `cursor-agent --version` during container start (slow; skipped by default) |

---

## Agent setup

All five agents speak **ACP** (Agent Client Protocol). Nova Code stores the ACP session id returned by `session/new` and resumes later turns with `session/load`. Chat events are ACP `SessionNotification` objects streamed to the dashboard.

The Docker image installs the CLIs. After starting the app:

1. Go to **Settings → Integrations → Agent Authentication**
2. Log in to **Cursor** and/or **Claude** (interactive terminal) and/or paste API keys for **Mistral Vibe**, **OpenCode**, and **Codex**
3. Credentials are stored under `/config` (by default `~/.novacode/config` on the host via the stock compose file) and persist across restarts

| Agent | How Nova Code talks to it |
|-------|---------------------------|
| **Cursor** | `cursor-agent acp` subprocess per turn (`CURSOR_COMMAND`) |
| **Claude** | In-process `@agentclientprotocol/claude-agent-acp` |
| **Mistral Vibe** | `vibe-acp` subprocess per turn; API key in Settings (`~/.vibe/.env` under `/config`) |
| **OpenCode** | `opencode acp` subprocess per turn |
| **Codex** | `codex-acp` subprocess per turn; API key in Settings |

Set **`VIBE_HOME`** (or **`AGENT_ENV_VIBE_HOME`**) if you use a non-default Vibe data directory.

### Troubleshooting (Claude Code)

- **Prompt appears to stop with no visible response** — if Claude returns a rate-limit or other ACP request error, Nova Code now surfaces it inline in the chat and stores Claude's reset time (when provided) so auto-continue can resume after reset.

### How session ids differ by agent

| Agent | Where the external session id comes from |
|-------|------------------------------------------|
| **Cursor** | ACP `session/new` on the first prompt (`cursor-agent acp`) |
| **Claude** | UUID returned by `ClaudeAcpAgent.newSession()` on the first prompt |
| **Mistral Vibe** | UUID returned by `vibe-acp` `newSession()`, reused with `loadSession()` |
| **OpenCode** | ACP `session/new` on the first prompt (`opencode acp`) |
| **Codex** | ACP `session/new` on the first prompt (`codex-acp`) |

### Troubleshooting (Mistral Vibe)

- **Agent unavailable in the UI** — `vibe-acp --version` must succeed on the server `PATH`, and the API key must be saved in Settings (see `GET /api/settings/agent-capabilities` / `mistralVibeAvailable`). Override the binaries with **`VIBE_COMMAND`** / **`VIBE_ACP_COMMAND`** if needed.
- **Assistant text repeated in one bubble** — Vibe may emit the same final assistant chunk more than once or send **cumulative** full-text updates instead of token deltas. The dashboard merges consecutive assistant chunks (skip identical repeats; treat longer strings that extend the previous chunk as replacements) so you should not see doubled sentences like `Task completed.Task completed.`

---

## Volume mounts

The API resolves workspace paths relative to `/data-root` inside the container.

The stock `docker-compose.yml` maps one host tree to `/data-root` and keeps app state on the host:

- `~/.novacode/config` → `/config` (app state, agent credentials)
- `~/.novacode/data` → `/data-root` (your projects — workspace paths in the app are relative to this directory)

Put repositories under `~/.novacode/data` on the host (for example `~/.novacode/data/acme-app`), then create a workspace in the app with path `acme-app`.

If you prefer several host locations instead of one tree, add more lines under `novacode.volumes`, for example:

```yaml
volumes:
  - ~/.novacode/config:/config
  - /home/yourname/projects:/data-root/projects
  - /home/yourname/work:/data-root/work
```

Then use workspace paths like `projects/my-repo` or `work/client-site`.

### Git push over SSH

The API generates an **ed25519** SSH keypair on startup (under `/config/.ssh/` on the config volume) if it is not already present, and configures Git to use it for SSH remotes. To push from the UI or agents:

1. Open **Settings → Git** and copy the **public** key into your Git host (GitHub, GitLab, Gitea, etc.).
2. Ensure the remote uses an **SSH** URL (for example `git@github.com:org/repo.git`). HTTPS remotes use the host’s credential helper, not this key.

The same screen lists the **private** key for advanced setups (treat it as a secret). Keys persist in `~/.novacode/config/.ssh/` on the host with the stock compose file.

---

## Development

The repo uses **npm workspaces** (`shared/`, `api/`, `dashboard/`) with a single root install:

```bash
npm install        # once, at the repo root — also builds shared/ and generates the Prisma client
```

### API

```bash
# Copy and fill in env vars
cp .env.example .env
cd api && npx prisma migrate dev && cd ..
npm run dev:api      # starts on PORT (default 3000 locally)
```

### Dashboard

```bash
# Point Vite at your local API
VITE_API_URL=http://localhost:3000/api npm run dev:dashboard
```

### Shared package (`shared/`)

`@novacode/shared` holds the canonical entity/WS-protocol types and the agent
stream-parsing logic used by **both** the API and the dashboard (previously two
hand-synced copies). It builds to `shared/dist` (dual CJS/ESM) via the root
`postinstall`; rebuild after editing with `npm run build -w @novacode/shared`.
Useful root scripts: `npm run build`, `npm run typecheck`, `npm run test`, `npm run lint:check`.
GitHub Actions runs test, typecheck, and lint before building the image.

### Docker (split services)

```bash
cp .env.example .env   # edit as needed
export UID=$(id -u) GID=$(id -g)
docker compose -f dev.docker-compose.yaml up --build
# API  → http://localhost:21000
# Dashboard → http://localhost:21001
```

### Database migrations

```bash
# Interactive helper (prompts for migration name)
./migrate-dev.sh

# Or directly
cd api && npx prisma migrate dev --name your_migration_name
```

---

## Project structure

This README is the **application** package. The full repository also includes **`web/`** (Astro + Starlight marketing and docs). Paths below are under `app/`.

```
app/
├── api/                  # Fastify backend (TypeScript)
│   ├── src/
│   │   ├── classes/      # DB, auth, config, PTY, chat engine, …
│   │   └── routes/       # REST + WebSocket route handlers
│   └── prisma/           # Schema + migrations
├── dashboard/            # Vue 3 frontend (Vite + Tailwind)
│   └── src/
│       ├── views/        # Page-level components
│       ├── components/   # Shared UI components
│       │   ├── ui/       # Design primitives (UiButton, UiToggle, EmptyState, EntityDetailHeader, BottomTabBar)
│       │   ├── chat/     # Chat surface (ChatMessageList, ChatDisplayItems, ChatComposer)
│       │   ├── workspace/# Workspace-specific (SessionCard, OrchestratorCard, GitView, …)
│       │   └── automations/
│       ├── composables/  # useChatSocket, useAgentOptions, usePlanDocuments, useAgentCapabilities, useLongPress
│       ├── lib/          # Framework-free helpers (themes, notifications, wsClient, mermaid)
│       ├── utils/        # chatDisplayItems, tagColors, agentTypeMeta, relativeTime, …
│       └── stores/       # Pinia stores (workspaces, orchestrators, auth, toasts, apiHealth)
├── shared/               # @novacode/shared — canonical types + stream parsing (API ⇄ dashboard)
│   └── src/
│       ├── types.ts      # Entity + WebSocket protocol types
│       ├── chatStreamPreview.ts
│       └── orchestratorPayload.ts
├── docs/                 # Additional documentation
├── scripts/
│   ├── install.sh        # One-line Docker install / update
│   └── docker-compose.install.yml
├── docker-compose.yml    # Production compose (build from Dockerfile)
├── dev.docker-compose.yaml
└── Dockerfile
```

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| API | [Fastify](https://fastify.dev) · TypeScript · [Prisma](https://prisma.io) · PostgreSQL |
| Real-time | WebSocket (`@fastify/websocket`) |
| Terminal | [node-pty](https://github.com/microsoft/node-pty) · [xterm.js](https://xtermjs.org) |
| Frontend | [Vue 3](https://vuejs.org) · [Pinia](https://pinia.vuejs.org) · [Tailwind CSS v4](https://tailwindcss.com) |
| Agents | Cursor Agent · Claude Code · Mistral Vibe · OpenCode · Codex (all via ACP) |

---

## Contributing

Pull requests are welcome. For larger changes, please open an issue first to discuss what you'd like to change.

### Coding conventions

Refactors and new code should follow the shared conventions used in this repo (import grouping, Vue section layout, boolean naming with a `b` prefix, and explicit control-flow braces).
Recent UI refactors standardize modal and menu scripts to the section-header layout (`Props`, `Emits`, `Store`, `Constants`, `Refs`, `Computed`, `Watchers`, `Methods`, `Lifecycle` as applicable), use the `b` prefix on local boolean refs in views such as **Automations** (`bLoading`, `bShowCreateForm`, …) and context-menu visibility (`bCtxMenuOpen`), merge duplicate `@/classes/api` imports where obvious, and replace inline control-flow one-liners with explicit `{}` blocks in script logic.
The stream-preview and orchestrator-payload logic now lives in `shared/` (`@novacode/shared`) as the single source of truth for both API and dashboard; the old per-app files are thin re-export shims. New shared behavior should be added there (with tests in `shared/src/*.test.ts`), not in per-app copies.
The dashboard chat surface is decomposed: stream→display parsing is pure logic in `dashboard/src/utils/chatDisplayItems.ts` (regression tests alongside), connection/state in `src/composables/`, and presentation in `src/components/chat/`. Reusable UI primitives live in `src/components/ui/` — use them for new UI instead of hand-rolling buttons/toggles/modals (`BaseModal` + `ModalHeader` for dialogs).

---

## License

[MIT](LICENSE) © Jonah Fintz (original author) and surfingbytes. See [Project status](#project-status).
