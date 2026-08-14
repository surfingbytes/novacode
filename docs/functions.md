# Nova Code — implemented functionality

This document describes what the application **does today** (backend API, dashboard, and supporting services). It reflects the codebase as of the last review, not a roadmap.

**Canonical detail:** this file is the in-tree inventory of routes, WebSockets, and known limitations.
**Refactor convention:** when touching API/Vue code, follow the in-repo style (import groups, no truncated names, `b` prefix for local boolean refs in the dashboard, explicit control-flow braces, and standard Vue script section headers). Examples: `AutomationsView.vue`, `ContextMenu.vue`, and context-menu parents (`bCtxMenuOpen`).

---

## 1. Product overview

Nova Code is a **self-hosted web application** for managing **AI coding agent** workflows: **Cursor Agent**, **Claude Code**, **Mistral Vibe**, **OpenCode**, and **Codex**, all over ACP. You organize work in **workspaces** (directories on disk), open **sessions** tied to a workspace and agent, and interact through a **chat UI** (with streaming), **terminal output** where applicable, and supporting tools for **Git**, **files**, **orchestrators**, and **workspace rules**.

Optional features include **scheduled automations**, **role templates**, and **browser push notifications**.

---

## 2. Authentication and accounts

- **First-run setup**: If no user exists, the app exposes a setup flow (`/api/auth/setup`) to create the initial account (username + password).
- **Login**: Password-based login returns a **JWT** used for API and WebSocket connections.
- **Account**: Password change, username change, and **API keys** (`GET`/`POST`/`DELETE /api/auth/api-tokens`). Keys are stored as SHA-256 hashes; the plaintext `nck_…` token is returned only on create. Send it as `Authorization: Bearer` (or the WebSocket `bearer.<token>` subprotocol).
- **REST auth**: JWT **or** an API key. There is no separate unscoped “service account”.
- **Claude token setup**: `POST /api/agent-auth/claude/login` spawns a `claude setup-token` PTY session; the terminal overlay auto-detects the token and saves it via `POST /api/agent-auth/claude/token`. `GET /api/agent-auth/claude/status` and `DELETE /api/agent-auth/claude/logout` complete the flow.
- **Mistral Vibe key setup**: Stored via `PUT /api/settings/vibe-api-key`; status checked with `GET /api/settings/vibe-api-key`; cleared with `DELETE /api/settings/vibe-api-key`.

---

## 3. Workspaces

- **Create / list / update / delete** workspaces. Each workspace has:
  - A **display name** and a **path** relative to the host root `/data-root` (where repos are mounted).
  - Optional **group** label, **color**, **sort order**, **tags** (JSON array), **default agent type** (`cursor-agent`, `claude`, `mistral-vibe`, `open-code`, or `codex`), **archived** flag.
  - Optional **per-workspace Git identity** (`gitUserName` / `gitUserEmail`) for commits and Git operations.
- **Browse directories**: API to list directories under the allowed root when picking a workspace path (`/api/workspaces/browse`).
- **Validation**: Workspace paths must stay under the configured browse root (security boundary).

---

## 4. Sessions

- **Create session**: `POST` to create a session in a workspace with a name, optional **tags**, and **agent type** (defaults from workspace or `claude`).
- **Claude (ACP)**: Sessions are created without a PTY bootstrap. The first prompt call issues `agent.newSession({ cwd })` via `@agentclientprotocol/claude-agent-acp` and the returned ACP session ID is stored for `resumeSession` on later turns.
- **Mistral Vibe (ACP)**: Each prompt turn spawns a `vibe-acp` subprocess. The first turn calls `newSession()`; subsequent turns call `loadSession()` (Vibe's disk-based session files under `VIBE_HOME`). The subprocess is killed after `prompt()` returns. The Vibe session ID is stored in the DB for continuity across turns.
- **Cursor / OpenCode / Codex (ACP)**: Each prompt turn spawns the agent ACP subprocess (`cursor-agent acp`, `opencode acp`, `codex-acp`) via `acpSubprocessRunner.ts`. The first turn calls `session/new`; later turns call `session/load` with the stored ACP session id.

**Session id summary**

| Agent | External session id |
|-------|---------------------|
| Claude (ACP) | UUID returned by `ClaudeAcpAgent.newSession()` on first prompt |
| Mistral Vibe (ACP) | UUID returned by `vibe-acp newSession()`, stored for `loadSession()` on later turns |
| Cursor / OpenCode / Codex | ACP `session/new` id from the subprocess runner, reused with `session/load` |
- **List / get / patch / delete**: Sessions support **rename**, **tags**, **archive**, and can be listed globally or per workspace (including archived where applicable).
- **Chat history**: Messages are stored in the **`session_messages`** table (not a JSON blob on the session) and stream to the dashboard over the chat WebSocket. Session **list** and **detail** responses omit full history for size; denormalized **`lastPreviewText`** / **`lastPreviewRole`** (`user` \| `assistant`) are updated when chat is persisted so sidebars can show a last-message snippet without loading full history. On **list** and **global WebSocket snapshot**, sessions missing those fields are **backfilled once** from stored messages (then persisted) so older threads still show a preview.
- **Usage**: ACP `usage_update` events are parsed during a turn and persisted as `session_usage` rows plus denormalized **`lastUsage`** on the session. `GET .../sessions/:id/usage` lists turns; `GET .../workspaces/:id/usage` returns workspace totals.
- **Real-time**: WebSocket endpoints for **session** streams and **chat**; separate channels for workspace-level session list updates (create/update/delete, “busy” state for active chat runs).
- **Images**: Upload **base64 images** to a session for multimodal-style prompts (stored under `/config`, with cleanup on session delete).

---

## 5. Chat and agent execution

- **Streaming chat**: WebSocket connection at `/api/ws/chat/:id` (JWT subprotocol `bearer.<jwt>`) for streaming agent output and chat events.
- **Chat engine**: Coordinates **active runs**, subscribers, **prompt dispatch**, cancellation, and persistence of **message history** (including streaming JSON lines from agents). On **cancel**, subprocess ACP agents receive `session/cancel` and a short grace period to settle the turn before the subprocess is killed, and the ACP session id resolved mid-turn is still persisted so the next prompt resumes via `session/load`; if a `session/load` fails and the agent falls back to a fresh session, a `session_reset_notice` event is persisted into the chat stream and shown as a notice in the dashboard.
- **Claude ACP integration**: Prompts are dispatched to `ClaudeAcpAgent` from `@agentclientprotocol/claude-agent-acp` (in-process, no subprocess). ACP `SessionNotification` objects (`{ sessionId, update }`) are serialised as-is and forwarded to the dashboard; **no conversion to a legacy format is performed**. The frontend detects ACP events by `typeof event.sessionId === 'string' && event.update` and handles `agent_message_chunk`, `tool_call`, and `tool_call_update` natively. Legacy cursor-style events stored in older sessions are still parsed for backward compatibility. All tool permissions are auto-approved by the embedded ACP client proxy.
- **Subprocess ACP agents** (`cursorAcp.ts`, `vibeAcp.ts`, `openCodeAcp.ts`, `codexAcp.ts`): Use `acpSubprocessRunner.ts` (`ClientSideConnection` + `ndJsonStream` from `@agentclientprotocol/sdk`) to talk to a per-prompt ACP subprocess over stdio. They emit the same `SessionNotification` shape as Claude — the frontend handles all agents identically. History replay events from `session/load` are discarded so only the current turn's events reach the dashboard.
- **Agent availability**: `claudeAvailable` requires the ACP package and a stored OAuth token. `mistralVibeAvailable` requires both `vibe-acp --version` succeeding and a Mistral API key in `VIBE_HOME/.env`. OpenCode and Codex report `openCodeAvailable` / `codexAvailable` from their respective probes.
- **Todo lists**: ACP `tool_call`s carrying `rawInput.todos`/`rawOutput.todos` (opencode's `todowrite` sends a structured object; Claude's `TodoWrite` likewise; vibe's `todo` tool sends JSON *strings* — both carriers are unwrapped) and Cursor's legacy `updateTodosToolCall` are parsed into normalized `todos` display items (`TODO_STATUS_*` statuses). The message stream keeps a compact one-line `Todos: done/total` trace; the live list itself is shown in a collapsible **Tasks** panel in the chat tab — a strip above the composer on mobile, a closable right-side column on desktop — derived from the latest todos item, so it works for live runs and history replay. Panel expand/close state persists in localStorage.
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
- **Diffs**, **commit**, **push/pull/fetch**, **branch checkout/create**, and **discard**.
- **Commit history**: `GET .../log` lists recent commits; `GET .../show` returns a patch. The Git pane has a Changes / History toggle.

---

## 9. File browser

- **List** directory contents (`GET .../files/list?path=&hidden=`) and **read/write** text files **within the workspace** path only (path traversal checks). Names starting with `.` are hidden unless `hidden=1`.
- **Create folder** (`POST .../files/mkdir`), **rename** (`POST .../files/rename`), and **delete** (`DELETE .../files?path=`, recursive). The workspace root cannot be deleted.
- Used by the dashboard **Files** view (show-hidden toggle, new file/folder, context-menu rename/delete).

---

## 9.1 Orchestrators

- **CRUD** under `/api/workspaces/:workspaceId/orchestrators`. A plan stores `subtasksJson` (`sharedContext`, `handoffLog`, `subtasks`).
- **Decompose** streams an LLM plan (`POST .../decompose`).
- **Run** (`POST .../run` with optional `startIndex`) executes each step in its own session. Steps may declare `dependsOn` (0-based indexes); if a dependency **failed** or was **skipped**, the step is marked skipped and the run continues. A step failure no longer aborts the rest of the plan. Final `runStatus` is `failed` if any step failed, otherwise `completed`.
- **Clone** (`POST .../clone`) copies name (`Copy of …`), tags, agent type, shared context, and steps without session ids or run results.
- The dashboard can **run from step N**, edit the plan after a run, and clone from the plan footer or the workspace sidebar.

---

## 10. Automations

- **Automations** are tied to a workspace: **name**, **agent type**, **prompt**, **interval** (minutes), **enabled**, **next run** / **last run**.
- A **scheduler** runs due automations; overlapping ticks for the same automation are skipped. Stale `running` rows are marked failed on API startup.
- Each run creates a tagged **session** (kept after the run, not deleted) and records **AutomationRun** (status, agent response, changed files, errors, `sessionId`). Git change detection includes nested repos one level down. Old runs are pruned to the last 50.
- Global and per-workspace listing and CRUD via `/api/automations` and nested routes. Manual **trigger** is `POST /api/automations/:id/trigger`.

---

## 11. Role templates

- Global **templates** (name, description, content); create, update, delete, list via `/api/role-templates`.
- In the **Rules** UI, templates can be used as a starting point when **creating a new workspace rule file** (so shared boilerplate does not need to be retyped).

---

## 12. Settings (user and app)

- **Git**: Global default `gitUserName` / `gitUserEmail` written to `/config/.gitconfig` (with `safe.directory = *`).
- **UI**: **Theme** (including **auto theme** and separate dark/light theme presets), **model selection** (e.g. auto vs specific Cursor models).
- **Agent capabilities**: Endpoints report whether **Claude**, **Cursor**, **Mistral Vibe**, **OpenCode**, and **Codex** are usable (CLI/ACP probes plus stored credentials where required).
- **Vibe (Mistral)**: Stored API key in `.vibe/.env` under config dir when configured; surfaced as `mistralVibeAvailable` with the `vibe-acp` probe.
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
- Completion notifications deep-link to the **session**, **orchestrator**, or **automations** page. Orchestrator and automation finishes also send a push.

---

## 15. Health and operations

- **`GET /api/health`**: Unauthenticated; returns `status` (`ok` / `degraded`), **uptime**, and **dbOk** after a simple DB check.
- **Graceful shutdown**: On `SIGTERM`/`SIGINT`, broadcasts **server-shutdown** over WebSockets, stops the automation scheduler, waits briefly, stops auth PTYs, closes Fastify.

---

## 16. Dashboard (Vue)

- **Views**: Home (workspace list), workspace detail (sessions list, **Files**, **Git**, **Rules**), **Session** (chat), **Orchestrator**, **Automations**, **Role templates**, **Settings**, **Account**, **Login**, **Setup** (wizard: Profile → AI Agents [Cursor, Claude, Vibe, OpenCode, Codex] → Git → Finalize).
- **Session snapshot cache**: The session view persists the last known chat messages + session detail (incl. plan documents) per session in `localStorage` (`nova:sessionCache:*`, latest 50 messages, `imageDataUrls` stripped). On mount or session switch the snapshot renders instantly (stale-while-revalidate) while REST + the chat WebSocket refresh it in parallel — the socket never waits on the session GET; the loading skeleton appears whenever there are no messages to show yet (an empty snapshot never masks in-flight history with the empty state, and empty writes never clobber a non-empty snapshot unless the emptiness is server-confirmed). A **Connecting…/Reconnecting…** pill shows whenever the chat socket isn't connected. Token validation on navigation is non-blocking so a poor connection can't delay first paint.
- **PWA**: Service worker (`sw.ts`) and Vite PWA plugin for installable/offline-capable behavior where configured.
- **Terminal**: **xterm.js** for terminal rendering in the session experience.

---

## 17. Stack summary

| Layer        | Technology |
|-------------|------------|
| API         | Fastify, TypeScript, Prisma, PostgreSQL |
| Real-time   | `@fastify/websocket`, WebSocket |
| Agents      | Claude Code (ACP in-process); Cursor, Mistral Vibe, OpenCode, Codex (ACP subprocess); `node-pty` |
| Dashboard   | Vue 3, Pinia, Vue Router, Tailwind CSS |

---

## 18. Related documents

- [`docs/improvement-plan.md`](improvement-plan.md) lists remaining ideas; it is not a guarantee of current behavior.
- [`api/README.md`](../api/README.md) covers role templates, API keys, and usage endpoints.
