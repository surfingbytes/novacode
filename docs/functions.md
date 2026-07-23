# Nova Code — implemented functionality

This document describes what the application **does today** (backend API, dashboard, and supporting services). It reflects the codebase as of the last review, not a roadmap.

**Canonical detail:** prefer the repository root [`functionality.md`](../../functionality.md) for route names, WebSocket paths, and known limitations; update this file when you need a shorter in-tree summary.
**Refactor convention:** when touching API/Vue code, follow `/data-root/personal/CODING_CONVENTIONS.md` (import groups, no truncated names, `b` prefix for local boolean refs in the dashboard, explicit control-flow braces, and standard Vue script section headers). Examples: `AutomationsView.vue`, `ContextMenu.vue`, and context-menu parents (`bCtxMenuOpen`).

---

## 1. Product overview

Nova Code is a **self-hosted web application** for managing **AI coding agent** workflows: **Claude** (via ACP), with **Cursor Agent** and **Mistral Vibe** UIs available for future ACP integration. You organize work in **workspaces** (directories on disk), open **sessions** tied to a workspace and agent, and interact through a **chat UI** (with streaming), **terminal output** where applicable, and supporting tools for **Git**, **files**, and **workspace rules**.

Optional features include **scheduled automations**, **role templates**, and **browser push notifications**.

---

## 2. Authentication and accounts

- **First-run setup**: If no user exists, the app exposes a setup flow (`/api/auth/setup`) to create the initial account (username + password).
- **Login**: Password-based login returns a **JWT** used for API and WebSocket connections.
- **Account**: Password change, username change, and related account endpoints (see `auth` routes).
- **REST auth**: Programmatic access uses the same **JWT** as the dashboard (`Authorization: Bearer`). There is **no** separate API-token table in the current schema (removed in migration `20260329120000_remove_api_tokens`).
- **Claude token setup**: `POST /api/agent-auth/claude/login` spawns a `claude setup-token` PTY session; the terminal overlay auto-detects the token and saves it via `POST /api/agent-auth/claude/token`. `GET /api/agent-auth/claude/status` and `DELETE /api/agent-auth/claude/logout` complete the flow.
- **Mistral Vibe key setup**: Stored via `PUT /api/settings/vibe-api-key`; status checked with `GET /api/settings/vibe-api-key`; cleared with `DELETE /api/settings/vibe-api-key`.

---

## 3. Workspaces

- **Create / list / update / delete** workspaces. Each workspace has:
  - A **display name** and a **path** relative to the host root `/data-root` (where repos are mounted).
  - Optional **group** label, **color**, **sort order**, **tags** (JSON array), **default agent type** (`cursor-agent`, `claude`, or `mistral-vibe`), **archived** flag.
  - Optional **per-workspace Git identity** (`gitUserName` / `gitUserEmail`) for commits and Git operations.
- **Browse directories**: API to list directories under the allowed root when picking a workspace path (`/api/workspaces/browse`).
- **Validation**: Workspace paths must stay under the configured browse root (security boundary).

---

## 4. Sessions

- **Create session**: `POST` to create a session in a workspace with a name, optional **tags**, and **agent type** (defaults from workspace or `claude`).
- **Claude (ACP)**: Sessions are created without a PTY bootstrap. The first prompt call issues `agent.newSession({ cwd })` via `@agentclientprotocol/claude-agent-acp` and the returned ACP session ID is stored for `resumeSession` on later turns.
- **Mistral Vibe (ACP)**: Each prompt turn spawns a `vibe-acp` subprocess. The first turn calls `newSession()`; subsequent turns call `loadSession()` (Vibe's disk-based session files under `VIBE_HOME`). The subprocess is killed after `prompt()` returns. The Vibe session ID is stored in the DB for continuity across turns.
- **Cursor Agent**: UI available; backend ACP integration pending.

**Session id summary**

| Agent | External session id |
|-------|---------------------|
| Claude (ACP) | UUID returned by `ClaudeAcpAgent.newSession()` on first prompt |
| Mistral Vibe (ACP) | UUID returned by `vibe-acp newSession()`, stored for `loadSession()` on later turns |
| Cursor | Pending ACP integration |
- **List / get / patch / delete**: Sessions support **rename**, **tags**, **archive**, and can be listed globally or per workspace (including archived where applicable).
- **Chat history**: Messages are stored in the database (`messageJson` on the session). Session **list** responses omit `messageJson` for size; denormalized **`lastPreviewText`** / **`lastPreviewRole`** (`user` \| `assistant`) are updated when chat is persisted so sidebars can show a last-message snippet without loading full history. On **list** and **global WebSocket snapshot**, sessions missing those fields are **backfilled once** from `message_json` (then persisted) so older threads still show a preview.
- **Real-time**: WebSocket endpoints for **session** streams and **chat**; separate channels for workspace-level session list updates (create/update/delete, “busy” state for active chat runs).
- **Images**: Upload **base64 images** to a session for multimodal-style prompts (stored under `/config`, with cleanup on session delete).

---

## 5. Chat and agent execution

- **Streaming chat**: WebSocket connection at `/api/ws/chat/:id` (with token) for streaming agent output and chat events.
- **Chat engine**: Coordinates **active runs**, subscribers, **prompt dispatch**, cancellation, and persistence of **message history** (including streaming JSON lines from agents). On **cancel**, subprocess ACP agents receive `session/cancel` and a short grace period to settle the turn before the subprocess is killed, and the ACP session id resolved mid-turn is still persisted so the next prompt resumes via `session/load`; if a `session/load` fails and the agent falls back to a fresh session, a `session_reset_notice` event is persisted into the chat stream and shown as a notice in the dashboard.
- **Claude ACP integration**: Prompts are dispatched to `ClaudeAcpAgent` from `@agentclientprotocol/claude-agent-acp` (in-process, no subprocess). ACP `SessionNotification` objects (`{ sessionId, update }`) are serialised as-is and forwarded to the dashboard; **no conversion to a legacy format is performed**. The frontend detects ACP events by `typeof event.sessionId === 'string' && event.update` and handles `agent_message_chunk`, `tool_call`, and `tool_call_update` natively. Legacy cursor-style events stored in older sessions are still parsed for backward compatibility. All tool permissions are auto-approved by the embedded ACP client proxy.
- **Mistral Vibe ACP integration** (`vibeAcp.ts`): Uses `ClientSideConnection` + `ndJsonStream` from `@agentclientprotocol/sdk` to talk to a per-prompt `vibe-acp` subprocess over stdio. Emits the same `SessionNotification` shape as Claude — the frontend handles both agents identically. History replay events from `loadSession()` are silently discarded by a null handler so only the current turn's events reach the dashboard. `cancelVibeAcp()` kills the subprocess. Adding a future ACP agent (e.g. another provider) follows the same `vibeAcp.ts` pattern.
- **Agent availability**: `claudeAvailable` requires the ACP package and a stored OAuth token. `mistralVibeAvailable` requires both `vibe-acp --version` succeeding and a Mistral API key in `VIBE_HOME/.env`.
- **Todo lists**: ACP `tool_call`s carrying `rawInput.todos` (e.g. Claude's `TodoWrite`, any todowrite-style tool) and Cursor's legacy `updateTodosToolCall` are parsed into normalized `todos` display items (`TODO_STATUS_*` statuses). The message stream keeps a compact one-line `Todos: done/total` trace; the live list itself is shown in a collapsible **Tasks** panel in the chat tab — a strip above the composer on mobile, a closable right-side column on desktop — derived from the latest todos item, so it works for live runs and history replay. Panel expand/close state persists in localStorage.
- **Workspace rules injection**: When building prompts, the server prepends content from **workspace rule files** (see §7) for all agents.

---

## 6. Terminal and WebSocket session output

- **PTY-based sessions**: `node-pty` runs agent processes (`PtyProcess`) with environment forwarded from `AGENT_ENV_*` and config (`HOME` under `/config`, Cursor/Claude config dirs, etc.).
- **WebSocket** `/api/ws/session/:id` for terminal I/O and session lifecycle (attach with JWT).
- **Session manager**: Short-lived **auth PTYs** (e.g. Cursor login) are managed separately from normal chat sessions.

---

## 7. Workspace rules (files)

- **CRUD** for rule **files** under a workspace-specific rules directory (see `workspaceRules` class): list, read, write, delete, rename.
- Rules are **injected into chat** context via a prefix built from those files (see `buildWorkspaceRulesPrefix` in `chatEngine`).

---

## 8. Git integration

- **Repository discovery** under the workspace (nested repos, depth limits, skip directories like `node_modules`).
- **Status**: Per-repo file status, ahead counts, etc.
- **Diffs** and other Git operations exposed via HTTP (see `git` routes) for use in the **Git** workspace view.

---

## 9. File browser

- **List** directory contents and **read/write** text files **within the workspace** path only (path traversal checks).
- Used by the dashboard **Files** view for the workspace.

---

## 10. Automations

- **Automations** are tied to a workspace: **name**, **agent type**, **prompt**, **interval** (minutes), **enabled**, **next run** / **last run**.
- A **scheduler** runs due automations; each run records **AutomationRun** (status, agent response, changed files, errors).
- Global and per-workspace listing and CRUD via `/api/automations` and nested routes.

---

## 11. Role templates

- Global **templates** (name, description, content); create, update, delete, list via `/api/role-templates`.
- In the **Rules** UI, templates can be used as a starting point when **creating a new workspace rule file** (so shared boilerplate does not need to be retyped).

---

## 12. Settings (user and app)

- **Git**: Global default `gitUserName` / `gitUserEmail` written to `/config/.gitconfig` (with `safe.directory = *`).
- **UI**: **Theme** (including **auto theme** and separate dark/light theme presets), **model selection** (e.g. auto vs specific Cursor models).
- **Agent capabilities**: Endpoints report whether **Claude** CLI is available, **Cursor** is authenticated, and **Mistral Vibe** is usable (CLI on `PATH` plus API key in `.vibe/.env` under the config dir).
- **Vibe (Mistral)**: Stored API key in `.vibe/.env` under config dir when configured; surfaced as `mistralVibeAvailable` with the `vibe` CLI probe.
- **MCP client config**: External MCP servers (stdio or HTTP) for Cursor / Claude; persisted as `mcp-clients.json` and synced to `.cursor/mcp.json` and `mcpServers` in `.claude.json` (read/write via settings API). **`POST /api/settings/mcp-clients/check`** runs a dry-run (stdio spawn probe, HTTP GET) and returns per-server results.
- **Claude token**: Optional stored token for Claude authentication.
- **Cursor login**: Flows that spawn a PTY for `cursor-agent` login and persist auth under `config`.

---

## 13. Agent authentication

- **Cursor**: Status checks (`auth.json` or `cursor-agent status`); **login** creates a short-lived PTY session users can complete in the UI.
- **Claude**: Status reflects stored token; **logout** clears stored credentials.

---

## 14. Push notifications

- **Web Push** (VAPID): Keys are generated on first run and stored under the config directory (`vapid-keys.json`); clients can subscribe; subscriptions are stored per user.
- **Public key** endpoint for the dashboard to register the service worker subscription.

---

## 15. Health and operations

- **`GET /api/health`**: Unauthenticated; returns `status` (`ok` / `degraded`), **uptime**, and **dbOk** after a simple DB check.
- **Graceful shutdown**: On `SIGTERM`/`SIGINT`, broadcasts **server-shutdown** over WebSockets, stops the automation scheduler, waits briefly, stops auth PTYs, closes Fastify.

---

## 16. Dashboard (Vue)

- **Views**: Home (workspace list), workspace detail (sessions list, **Files**, **Git**, **Rules**), **Session** (chat), **Automations**, **Role templates**, **Settings**, **Account**, **Login**, **Setup** (4-step wizard: Profile → AI Agents [Claude + Mistral Vibe] → Git → Finalize).
- **PWA**: Service worker (`sw.ts`) and Vite PWA plugin for installable/offline-capable behavior where configured.
- **Terminal**: **xterm.js** for terminal rendering in the session experience.

---

## 17. Stack summary

| Layer        | Technology |
|-------------|------------|
| API         | Fastify, TypeScript, Prisma, PostgreSQL |
| Real-time   | `@fastify/websocket`, WebSocket |
| Agents      | Claude Code (ACP in-process), Mistral Vibe (`vibe-acp` subprocess, ACP over stdio), Cursor Agent CLI (pending ACP), `node-pty` |
| Dashboard   | Vue 3, Pinia, Vue Router, Tailwind CSS |

---

## 18. Related documents

- `FEATURES.md` in the repo root lists **ideas and future improvements**; it is **not** a guarantee of current behavior.
