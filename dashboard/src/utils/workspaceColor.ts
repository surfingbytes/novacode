/**
 * Workspace identity color helpers — single source for tinting session rows
 * (sidebar, home) with the owning workspace's color.
 */

// types
import type { Workspace } from '@/@types/index';

type WorkspaceColorSource = Pick<Workspace, 'color'> | null | undefined;

/** Workspace color with accent fallback (color is nullable in the DB). */
export function workspaceColor(workspace: WorkspaceColorSource): string {
  const color = workspace?.color?.trim();
  return color ? color : 'var(--accent)';
}

/**
 * Session status dot tinted with the workspace color: busy = full color with
 * glow, idle = dimmed. Inline style because the color is dynamic per workspace
 * (mirrors the .nc-status-dot busy glow in main.css).
 */
export function sessionStatusDotStyle(
  workspace: WorkspaceColorSource,
  busy: boolean | undefined
): Record<string, string> {
  const color = workspaceColor(workspace);
  if (busy) {
    return {
      background: color,
      boxShadow: `0 0 0 3px color-mix(in oklab, ${color} 20%, transparent)`
    };
  }
  return { background: `color-mix(in oklab, ${color} 35%, transparent)` };
}
