/** API/WebSocket: session.tags stored as JSON array; expose as string[] | null. */
export function normalizeSessionForApi<T extends { tags?: unknown; sessionConfigJson?: string | null }>(
  s: T
): Omit<T, 'tags' | 'sessionConfigJson'> & { tags: string[] | null; sessionConfigJson: Record<string, string> | null } {
  const raw = s.tags;
  let tags: string[] | null = null;
  if (Array.isArray(raw)) {
    const seen = new Set<string>();
    const parsed: string[] = [];
    for (const x of raw) {
      if (typeof x !== 'string') continue;
      const t = x.trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      parsed.push(t);
    }
    tags = parsed.length > 0 ? parsed : null;
  }

  let sessionConfigJson: Record<string, string> | null = null;
  if (s.sessionConfigJson) {
    try {
      const parsed = JSON.parse(s.sessionConfigJson) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        sessionConfigJson = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).filter(
            (entry): entry is [string, string] =>
              typeof entry[1] === 'string' && !entry[0].startsWith('__nova')
          )
        );
      }
    } catch {
      sessionConfigJson = null;
    }
  }

  const { sessionConfigJson: _omit, ...rest } = s;
  return { ...rest, tags, sessionConfigJson } as Omit<T, 'tags' | 'sessionConfigJson'> & {
    tags: string[] | null;
    sessionConfigJson: Record<string, string> | null;
  };
}
