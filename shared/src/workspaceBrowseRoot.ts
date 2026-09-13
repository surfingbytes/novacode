/**
 * Default in-container browse root when `WORKSPACE_BROWSE_ROOT` is unset.
 * Stock docker-compose mounts host project data here; override the env for native paths (e.g. `/opt`).
 * All runtime code must use `config.workspaceBrowseRoot` / settings `workspaceBrowseRoot` — never a bare `/data-root` literal.
 */
export const DEFAULT_WORKSPACE_BROWSE_ROOT = '/data-root';
