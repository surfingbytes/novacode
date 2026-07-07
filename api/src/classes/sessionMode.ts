import { MODE_SENTINEL } from './agentModes';

/** Empty/null session mode → sentinel `default`. */
export function normalizeSessionMode(mode: string | null | undefined): string {
  if (!mode) return MODE_SENTINEL;
  return mode;
}
