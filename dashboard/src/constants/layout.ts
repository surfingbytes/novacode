/** Routes that use the full viewport height and hide the global top bar on mobile. */
export const FULL_HEIGHT_ROUTE_NAMES = new Set([
  'session',
  'orchestrator',
  'workspace-files'
]);

export const APP_NAV_TOGGLE_KEY = Symbol('appNavToggle') as import('vue').InjectionKey<
  () => void
>;
