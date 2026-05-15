/** API/WebSocket: session.tags stored as JSON array; expose as string[] | null. */
export function normalizeSessionForApi<T extends { tags?: unknown }>(
  s: T
): Omit<T, 'tags'> & { tags: string[] | null } {
  const raw = s.tags;
  if (!Array.isArray(raw)) {
    return { ...s, tags: null };
  }
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string') {
      continue;
    }
    const t = x.trim();
    if (!t) {
      continue;
    }
    const k = t.toLowerCase();
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    tags.push(t);
  }
  return { ...s, tags: tags.length > 0 ? tags : null };
}
