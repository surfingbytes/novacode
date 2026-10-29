# API service

JSON under `/api`. The dashboard signs in with an **httpOnly session cookie** (7-day JWT, refreshed on `/api/auth/validate`). Scripts should use a hashed **API key** from **Account → API keys** as `Authorization: Bearer`. Cookies and Bearer tokens are the only auth: a `?token=` query parameter is ignored.

WebSocket clients authenticate the same way (cookie, or the `bearer.<token>` subprotocol). An upgrade that sends an `Origin` header must come from an allowed CORS origin or the server's own host, otherwise it is closed with code 4003. Non-browser clients can leave `Origin` out.

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

### CI providers (Gitea, Forgejo, GitHub, GitLab)

Any number of connections can be configured side by side; workspaces are matched by their git remote host.

- `GET /api/forge/connections` — `{ connections: ForgeConnectionStatus[] }` (never returns tokens)
- `POST /api/forge/connections` — `{ provider, url, token, name?, remoteHosts? }`; tests, then stores in `forge.json`
- `PUT /api/forge/connections/:id` — same body; omit `token` to keep the stored one
- `DELETE /api/forge/connections/:id`
- `POST /api/forge/test` — `{ provider, url, token?, connectionId? }` → `{ ok, provider?, version?, username?, error? }`
- `GET /api/forge/workspace/:workspaceId/repo` — connection + repo the workspace resolves to (override or remote)
- `GET /api/forge/workspace/:workspaceId/ci?repo=&sessionId=` — `CiStatusResponse` for the checked-out branch
- `POST /api/forge/workspace/:workspaceId/ci/runs/:runId/fix-prompt?repo=` — `{ prompt, includesLogs }` for the agent

Token scopes: Gitea/Forgejo `read:repository` + `read:user`; GitHub fine-grained read access to Actions, Commit statuses and Metadata (classic: `repo`); GitLab `read_api`. Env `FORGE_URL` + `FORGE_TOKEN` (+ `FORGE_PROVIDER`, `FORGE_NAME`, `FORGE_REMOTE_HOSTS`) adds a read-only connection.

Push subscriptions accept `notifyTasks` / `notifyCi` to choose which notifications a device receives.
