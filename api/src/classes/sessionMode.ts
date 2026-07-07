import { MODE_SENTINEL } from './agentModes';

/** Empty/null (or legacy `auto`) session mode → sentinel `default`. */
export function normalizeSessionMode(mode: string | null | undefined): string {
  // `auto` was the previous mode sentinel before it was renamed to `default`.
  if (!mode || mode === 'auto') return MODE_SENTINEL;
  return mode;
}
