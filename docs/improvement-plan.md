# Nova Code — remaining improvements

Shipped work has been removed from this list. Items below are still open.

## Features

- **Session templates** — starter sessions (“Code review”, “Add tests”) with a pre-filled first prompt.
- **Chat branching** — restore or fork conversation snapshots.
- **Suggested follow-ups** — short prompt chips after an assistant reply.
- **Orchestrator templates** — seed plans such as “Feature + tests”.
- **Recent files** — quick access to files opened in a workspace.
- **Webhooks** — outbound events when a session or orchestrator finishes.
- **Chat bots** — optional Slack / Discord / Teams entry points.
- **In-app notification center** — bell for events while the tab is open (web push already exists).
- **Email alerts** — optional mail when a plan or automation fails.
- **Multi-user** — workspaces are not owned by a user today; a second account would see everything. Invite links and an audit log belong with that work, not before it.

## UI

- Pagination or virtualized lists for workspaces with hundreds of sessions.
- Keyboard shortcuts for new orchestrator and refresh (Ctrl+K search and Ctrl/Cmd+N new session already exist).
- Accessibility: remaining `aria-label`s, `prefers-reduced-motion` (modal focus trap is already in BaseModal).
- Custom theme colors.
- Global toast on 403/5xx (401 logout is already handled).

## Testing and docs

- Playwright smoke: setup → workspace → session.
- Broader API route tests (auth, session create, orchestrator run).
- OpenAPI spec generated from Fastify TypeBox schemas.
- Short in-app tour for first-time users.
