/** Permission / tool labels that must not be used as the plan document title. */
const GENERIC_PLAN_TITLES = new Set([
  'approve plan',
  'exited plan mode',
  'exitplanmode',
  'exit plan mode',
]);

function firstMarkdownHeading(markdown: string): string {
  return markdown.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() ?? '';
}

/**
 * Pick a display title for a plan: prefer a real title, else the first markdown
 * heading. Rejects Claude ExitPlanMode labels like "Approve Plan".
 */
export function resolvePlanDisplayTitle(
  title: string | undefined,
  markdown: string | undefined
): string | undefined {
  const trimmed = title?.trim();
  if (trimmed && !GENERIC_PLAN_TITLES.has(trimmed.toLowerCase())) {
    return trimmed;
  }
  const heading = markdown?.trim() ? firstMarkdownHeading(markdown.trim()) : '';
  return heading || undefined;
}
