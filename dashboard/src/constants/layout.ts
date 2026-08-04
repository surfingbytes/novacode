/** Routes that use the full viewport height and hide the global top bar on mobile. */
export const FULL_HEIGHT_ROUTE_NAMES = new Set([
  'session',
  'orchestrator',
  'workspace-files'
]);

/**
 * Min CSS viewport width for master-detail (list + content) panes.
 * Samsung Fold inner displays are often ~670–720px — under Tailwind `md` (768px).
 */
export const PANE_LAYOUT_MIN_WIDTH = 600;

export const APP_NAV_TOGGLE_KEY = Symbol('appNavToggle') as import('vue').InjectionKey<
  () => void
>;
