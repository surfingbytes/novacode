# Nova Code — Improvement Plan

This document outlines a detailed plan for **new features**, **UI improvements**, **current problem areas**, and **general improvements** based on a review of the application (Fastify API + Vue 3 dashboard, workspaces, sessions, orchestrators, themes, etc.).

---

## 1. New Possible Features

### 1.1 Search and discovery

- **Global search**
  - Search across workspaces, sessions, orchestrators, and (optionally) file names or chat content.
  - Quick jump (e.g. Cmd/Ctrl+K) to open a command palette that searches and navigates.
- **Session/orchestrator search**
  - Filter sessions and orchestrators by name or category from the workspace view (beyond the existing category filter).
  - Optional full-text search on session names and last message summary.

### 1.2 Session and chat enhancements

- **Session templates**
  - Predefined prompts or “starter” sessions (e.g. “Code review”, “Refactor”, “Add tests”) that create a session with a pre-filled system or first message.
- **Chat export**
  - Export a session’s chat (and optionally tool calls) as Markdown or JSON for sharing or backup.
- **Chat branching / history**
  - View or restore previous conversation branches or snapshots (if the backend stores message history in a way that supports it).
- **Suggested follow-ups**
  - After an assistant reply, show 1–3 suggested short follow-up prompts (e.g. “Explain this”, “Add tests”, “Simplify”) to reduce typing.

### 1.3 Orchestrator enhancements

- **Templates for task plans**
  - Predefined orchestrator templates (e.g. “Feature + tests”, “Bugfix + docs”) that seed subtasks or decomposition instructions.
- **Re-run from step**
  - Allow “Run from step N” so only steps N..end are executed (e.g. after editing step 3, re-run from 3).
- **Clone orchestrator**
  - Duplicate an existing orchestrator (same workspace or another) to reuse a plan with small edits.
- **Subtask dependencies**
  - Optional “depends on step X” so the UI/API can show order and skip steps whose dependencies failed.

### 1.4 Workspace and file UX

- **Recent files**
  - List or quick-access to recently opened/edited files per workspace (from Files view or chat).
- **Favorites / bookmarks**
  - Pin specific sessions, orchestrators, or file paths for quick access from home or navbar.
- **Workspace tags/labels**
  - In addition to (or instead of) a single color, support tags (e.g. “work”, “experiment”) and filter the home list by tag.

### 1.5 Integrations and automation

- **Webhooks**
  - Outgoing webhooks on events (e.g. “orchestrator completed”, “session created”) for CI or external tools.
- **Slack/Discord/Teams**
  - Optional bot to create sessions or run orchestrators from chat.

### 1.6 Notifications and feedback

- **In-app notification center**
  - A bell or dropdown showing recent events (orchestrator done, session error) with links to the relevant page.
- **Email alerts (optional)**
  - Optional email when an orchestrator completes or fails (configurable in settings).

### 1.7 Multi-user and collaboration (if scope expands)

- **Invite/link sharing**
  - Share a workspace or session via a time-limited link (view-only or with edit rights).
- **Audit log**
  - Log who did what (create/delete session, run orchestrator, change settings) for self-hosted teams.

---

## 2. Possible UI Improvements

### 2.1 Consistency and layout

- **Unified empty states**
  - Use the same empty-state pattern (icon, short message, primary action) across Workspaces, Sessions, Orchestrators, Categories, and Files/Git.
- **Breadcrumbs**
  - Add breadcrumbs (e.g. Workspaces → Workspace name → Sessions) on workspace, session, and orchestrator views to improve orientation and back-navigation.
- **Sticky headers**
  - Keep section headers (e.g. “Orchestrators”, “Sessions”) or toolbar sticky while scrolling long lists so actions remain visible.

### 2.2 Navigation and information architecture

- **NavBar workspace switcher**
  - When inside a workspace, show current workspace name in the navbar with a dropdown to switch to another workspace without going back to home.
- **Sidebar (optional)**
  - Optional collapsible sidebar with workspace list, “Recent” sessions/orchestrators, and links to Settings/Categories for faster switching.
- **404 and error page**
  - Add a catch-all route that renders a friendly “Page not found” with a link to Home and optional search; use the same layout (e.g. NavBar) for consistency.

### 2.3 Session view (chat)

- **Message grouping**
  - Visually group consecutive messages by role (user vs assistant) and collapse long tool-output blocks with “Show more”.
- **Copy code blocks**
  - One-click copy on code blocks in assistant messages.
- **Syntax highlighting**
  - Ensure code blocks in chat use the same (or improved) syntax highlighting as in Files/Monaco where applicable.
- **Scroll behavior**
  - “Scroll to bottom” FAB when the user has scrolled up in a long chat; optional “Jump to latest” in the message list.
- **Model selector placement**
  - Make model selector (auto / specific model) more visible and consistent (e.g. in the input bar or a small header chip).

### 2.4 Workspace and list views

- **Skeleton loaders**
  - Replace generic spinners with skeleton placeholders for session/orchestrator/workspace cards while loading.
- **Infinite scroll or pagination**
  - For workspaces with many sessions/orchestrators, add pagination or virtualized list to keep the DOM light and improve performance.
- **Card density**
  - Allow a “compact” list mode (e.g. single line per session with icon, name, time) in addition to current card/grid.
- **Keyboard shortcuts**
  - Shortcuts for “New Session”, “New Orchestrator”, “Refresh”, and (if implemented) “Search” from workspace and home views.

### 2.5 Forms and modals

- **Validation feedback**
  - Show inline validation (e.g. “Path must be under /data-root”) on Workspace create/edit and other forms instead of only on submit.
- **Loading and disabled state**
  - Disable submit buttons and show a small spinner during create/update/delete to avoid double submission.
- **Confirm destructive actions**
  - Use the existing `ConfirmModal` consistently for all delete/archive actions; consider a “Don’t ask again for this session” option for power users.

### 2.6 Accessibility and responsiveness

- **Focus management**
  - When opening modals, trap focus and return focus to the trigger on close; ensure Escape closes modals.
- **ARIA and labels**
  - Add `aria-live` for dynamic status (e.g. “Orchestrator running step 2/5”); ensure icon-only buttons have `aria-label` (NavBar already has some).
- **Touch targets**
  - Ensure buttons and links are at least 44px for touch on mobile; the existing viewport-height handling is a good start.
- **Reduced motion**
  - Respect `prefers-reduced-motion` for transitions and animations (e.g. view transitions, busy spinners).

### 2.7 Visual polish

- **Themes**
  - Already strong (Deep Space, Carbon, Terminal Green, OLED, etc.). Consider a “Custom” theme where users can override primary/surface colors via settings.
- **Icons**
  - The app uses Material Icons. Consider a single icon set (or a small set) and use it consistently; ensure all actions have an icon where it helps.
- **Tooltips**
  - Add tooltips to icon-only buttons (e.g. delete, edit, view mode toggle) especially on desktop.

---

## 3. Current Problem Areas

### 3.1 Error handling and user feedback

- **No global API error handler**
  - Failed requests are often only logged with `console.error`; the user may see no feedback. Introduce a global axios (or fetch) response interceptor that:
    - On 401: clear token and redirect to login.
    - On 403/404/5xx: show a toast or inline banner with a short message and optional “Retry”.
- **Use of `alert()`**
  - `HomeView.vue` uses `alert(msg)` for delete workspace failure. Replace with the same toast or inline error pattern used elsewhere.
- **Silent failures**
  - Several `catch` blocks only set local state or do nothing; consider at least a non-intrusive toast (e.g. “Could not save”) so the user knows something failed.

### 3.2 Codebase and maintainability

- **Oversized `WorkspaceView.vue`**
  - The file is very large (~1,600+ lines) and handles sessions, orchestrators, categories, modals, bulk actions, and view modes. Consider:
    - Extracting “Sessions list” and “Orchestrators list” into separate components (e.g. `SessionList.vue`, `OrchestratorList.vue`).
    - Moving category color/helper logic and shared constants (e.g. `CATEGORY_COLORS`) into a composable or shared module.
- **Duplicated logic**
  - `CATEGORY_COLORS` and `categoryColorClass()` (or equivalent) appear in `WorkspaceView`, `SessionView`, and `CategoriesView`. Centralize in one place (e.g. `lib/categories.ts` or a composable).
- **Debug logging in production**
  - `console.log` and `console.error` are used in API (`chatEngine.ts`, `index.ts`) and dashboard (`AppTerminal.vue`, etc.). Use a small logger that is no-op (or log-level gated) in production.

### 3.3 Security (from existing audit and code review)

- **Path traversal and custom agent**
  - The security audit documents critical/high issues (workspace path validation, custom agent command allowlist). These should be addressed before or alongside new features; see `docs/security-audit.md`.
- **Token in WebSocket URL**
  - JWT is passed in query string for WebSockets (`?token=...`). Consider moving to a header or first-message auth if the stack allows, to avoid token in logs/referrer.

### 3.4 Data and state

- **No optimistic updates**
  - Create/update/delete of sessions and orchestrators refetch the full list. For a snappier feel, consider optimistic updates (add to list immediately, rollback on error).
- **Stale data after navigation**
  - When returning to a workspace view, data is refetched via `watch(workspaceId, ensureData)`, which is good; ensure session/orchestrator detail views also refetch or invalidate when coming back from another page.
- **Session “busy” state**
  - `busy` is computed on the API from active session IDs; the dashboard does not subscribe to real-time updates. Consider WebSocket or short polling on the workspace page when any session is busy so the badge updates without refresh.

### 3.5 Testing and reliability

- **Sparse test coverage**
  - Only `CategoriesView.spec.ts` (and possibly API tests) were evident. Add unit tests for:
    - Composables and shared utilities (e.g. category colors, relative time).
    - Critical API modules (auth, session create, orchestrator run).
  - Add a few E2E tests (e.g. login → create workspace → create session) to guard regressions.

### 3.6 Documentation and onboarding

- **In-app help**
  - First-time users may not know about orchestrators or categories. Consider a short “Tour” or “Help” panel (dismissible) that highlights main entry points.
- **API documentation**
  - No OpenAPI/Swagger was visible. Generating an OpenAPI spec from the Fastify routes would help frontend and third-party integrations.

---

## 4. Possible General Improvements

### 4.1 Frontend

- **Centralized API error handling**
  - As in §3.1: one place to handle 401/403/404/5xx and to show toasts or banners.
- **Composables for repeated logic**
  - Extract “list with loading/error/retry”, “modal open/close state”, “bulk selection” into composables to reduce duplication and simplify views.
- **Type safety**
  - Ensure `@/@types/index` (or equivalent) is the single source of truth for API shapes; align API response types with Prisma/backend so the dashboard stays in sync.
- **PWA**
  - The project has `vite-plugin-pwa`; verify offline behavior and “Add to home screen” experience (e.g. show a friendly message when offline).

### 4.2 Backend

- **Validation**
  - Use a schema (e.g. TypeBox, already in use) for all request bodies and validate paths against the workspace browse root (`/data-root`) on create/update workspace.
- **Structured logging**
  - Replace ad-hoc `console.log` with a logger (e.g. Pino, which is already a dependency) and log request IDs for tracing.
- **Health check**
  - Extend `/api/health` to optionally check DB connectivity so operators can monitor dependency health.

### 4.3 DevOps and configuration

- **Environment validation**
  - On startup, validate required env vars (e.g. `POSTGRES_*` or `DATABASE_URL`, `JWT_SECRET`) and fail fast with clear messages.
- **Docker**
  - Document or add a healthcheck in the Docker image so orchestration can restart unhealthy containers.

### 4.4 Performance

- **Lazy load heavy components**
  - Session view (Monaco, xterm, markdown) is heavy; ensure route-level code-splitting is in place (already using dynamic `import()` for routes).
- **Virtualize long lists**
  - For workspace/session/orchestrator lists with hundreds of items, use a virtual list (e.g. `vue-virtual-scroller` or similar) to limit DOM nodes.
- **Debounce search/filter**
  - If search or filter is added, debounce input to avoid excessive re-renders or API calls.

### 4.5 Developer experience

- **Scripts**
  - Add `npm run typecheck` (or equivalent) at repo root that runs both API and dashboard type checks.
- **README**
  - The main README is clear; add a “Contributing” or “Development” section with steps to run tests, lint, and apply migrations.
- **Coding conventions**
  - Keep `app/dashboard` Vue components and `app/api` route files aligned with `/data-root/personal/CODING_CONVENTIONS.md` (import groups, section headers, boolean naming, and block-style control flow).

---

## Summary table

| Area                                              | Priority (suggested) | Effort      |
| ------------------------------------------------- | -------------------- | ----------- |
| Global API error handling + toasts                | High                 | Medium      |
| Split WorkspaceView + centralize category helpers | High                 | Medium      |
| 404 + breadcrumbs                                 | Medium               | Low         |
| Session/orchestrator search                       | Medium               | Medium      |
| Re-run orchestrator from step N                   | Medium               | Medium      |
| Security fixes (path traversal, custom agent)     | High                 | Medium      |
| Tests (unit + E2E)                                | High                 | High        |
| In-app onboarding/help                            | Low                  | Medium      |
| Webhooks / notification center                    | Low                  | Medium–High |

This plan can be used to pick a subset of items per release and to track progress over time.
