# API service

JSON under `/api`. The dashboard signs in with an **httpOnly session cookie** (7-day JWT, refreshed on `/api/auth/validate`). Scripts should use a hashed **API key** from **Account → API keys** as `Authorization: Bearer`.

Optional **OIDC** (`OIDC_ISSUER` + client id/secret) adds SSO next to password login. Restrict who can open the app in the identity provider (Authentik application assignment, Authelia access rules, and so on) — Nova Code still maps a successful login to the single local owner account.

## Role templates

Reusable Markdown snippets for new workspace or global rule files.

- `GET /api/role-templates` — list
- `POST /api/role-templates` — create `{ name, description?, content }`
- `GET /api/role-templates/:templateId` — fetch one
- `PUT /api/role-templates/:templateId` — update
- `DELETE /api/role-templates/:templateId` — delete

Each template has `id`, `name`, optional `description`, Markdown `content`, and ISO `createdAt` / `updatedAt`.

In the **Rules** UI (workspace or **Settings → Rules**), pick a template when creating a new rule file so shared boilerplate is not retyped. Templates are **not** copied onto sessions.

## Global rules

Markdown files under `/config/global-rules`, injected into every agent prompt (before workspace rules).

- `GET /api/global-rules` — list `{ filename, label }`
- `GET /api/global-rules/:filename` — `{ filename, content }`
- `PUT /api/global-rules/:filename` — `{ content }` (creates the directory on first write)
- `DELETE /api/global-rules/:filename`
- `PATCH /api/global-rules/:filename` — `{ newFilename }`

## API keys

- `GET /api/auth/api-tokens` — list metadata (prefix, last used). The secret is never returned again.
- `POST /api/auth/api-tokens` — `{ name }` → metadata plus the plaintext `token` **once**.
- `DELETE /api/auth/api-tokens/:id` — revoke

Send `Authorization: Bearer nck_…` on REST calls (and as the WebSocket `bearer.<token>` subprotocol). Keys are stored as SHA-256 hashes.

## Usage

Agents that emit ACP `usage_update` events persist a snapshot per turn.

- `GET /api/workspaces/:workspaceId/sessions/:sessionId/usage` — `{ turns: SessionUsageTurn[], summary: SessionUsageSummary }`
- `GET /api/workspaces/:workspaceId/usage` — workspace totals

### Cursor account usage

Uses the existing `cursor-agent login` token (`~/.config/cursor/auth.json`) — no Org/Admin API key.

- `GET /api/agent-auth/cursor/usage` — `{ authenticated, available, individual?, teamOnDemand?, billingCycleEnd? }` from Cursor `GET /api/usage-summary` (cached ~5 minutes)

### Gitea / Forgejo CI

- `GET /api/forge/settings` — `{ configured, source, url, provider, version }` (never returns the token)
- `PUT /api/forge/settings` — `{ url, token? }`; tests the connection, then stores `forge.json` in the config dir (omit `token` to keep the stored one)
- `DELETE /api/forge/settings` — remove file settings (env `FORGE_URL` + `FORGE_TOKEN` still wins if set)
- `POST /api/forge/test` — `{ url, token? }` → `{ ok, provider?, version?, username?, error? }`
- `GET /api/forge/workspace/:workspaceId/repo` — forge `owner/name` (workspace override or detected from the git remote)
- `GET /api/forge/workspace/:workspaceId/ci?repo=&sessionId=` — `CiStatusResponse` for the checked-out branch (Actions runs, falling back to commit statuses)
- `POST /api/forge/workspace/:workspaceId/ci/runs/:runId/fix-prompt?repo=` — `{ prompt, includesLogs }` for the agent

The token needs `read:repository` and `read:user`. Push subscriptions accept `notifyTasks` / `notifyCi` to choose which notifications a device receives.
