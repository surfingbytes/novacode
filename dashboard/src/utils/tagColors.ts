/**
 * Deterministic tag/category → color-chip classes.
 * Single source: previously copy-pasted into SessionChat.vue,
 * OrchestratorPanel.vue and WorkspaceSidebar.vue (one copy had a broken
 * yellow entry — invisible text and no border).
 */

const TAG_COLOR_CLASSES = [
  'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'bg-purple-500/15 text-purple-400 border-purple-500/20',
  'bg-green-500/15 text-green-400 border-green-500/20',
  'bg-orange-500/15 text-orange-400 border-orange-500/20',
  'bg-pink-500/15 text-pink-400 border-pink-500/20',
  'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
  'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  'bg-red-500/15 text-red-400 border-red-500/20'
] as const;

export function tagColorClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return TAG_COLOR_CLASSES[hash % TAG_COLOR_CLASSES.length];
}

/** @deprecated Legacy name kept for existing call sites. */
export const categoryColorClass = tagColorClass;
