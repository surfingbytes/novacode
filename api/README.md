# API service

JSON under `/api`. Dashboard sessions use a JWT (`Authorization: Bearer`). Scripts can use a hashed **API key** from **Account → API keys** the same way.

## Role templates

Reusable Markdown snippets for new workspace rule files.

- `GET /api/role-templates` — list
- `POST /api/role-templates` — create `{ name, description?, content }`
- `GET /api/role-templates/:templateId` — fetch one
- `PUT /api/role-templates/:templateId` — update
- `DELETE /api/role-templates/:templateId` — delete

Each template has `id`, `name`, optional `description`, Markdown `content`, and ISO `createdAt` / `updatedAt`.

In the **Rules** UI, pick a template when creating a new workspace rule file so shared boilerplate is not retyped. Templates are **not** copied onto sessions.

## API keys

- `GET /api/auth/api-tokens` — list metadata (prefix, last used). The secret is never returned again.
- `POST /api/auth/api-tokens` — `{ name }` → metadata plus the plaintext `token` **once**.
- `DELETE /api/auth/api-tokens/:id` — revoke

Send `Authorization: Bearer nck_…` on REST calls (and as the WebSocket `bearer.<token>` subprotocol). Keys are stored as SHA-256 hashes.

## Usage

Agents that emit ACP `usage_update` events persist a snapshot per turn.

- `GET /api/workspaces/:workspaceId/sessions/:sessionId/usage` — `{ turns: SessionUsageTurn[] }`
- `GET /api/workspaces/:workspaceId/usage` — workspace totals
