/** True when the user asked the OS/browser to minimise non-essential motion. */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** Smooth scrolling downgraded to an instant jump when reduced motion is requested. */
export function motionSafeScrollBehavior(behavior: ScrollBehavior): ScrollBehavior {
  return behavior === 'smooth' && prefersReducedMotion() ? 'auto' : behavior;
}
