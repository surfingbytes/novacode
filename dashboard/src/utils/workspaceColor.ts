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

/** Dimmed color every idle status icon (dot, star, orchestrator ring) uses, so they all match. */
export function idleStatusColor(color: string): string {
  return `color-mix(in oklab, ${color} 35%, transparent)`;
}

/**
 * Session status dot tinted with the workspace color: busy = full color with
 * glow, idle = dimmed. Finished/unread is a separate badge — never a glow,
 * which reads as still running. Inline style because the color is dynamic
 * per workspace (mirrors the .nc-status-dot busy glow in main.css).
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
  return { background: idleStatusColor(color) };
}

/**
 * Favorite star in the sidebar status slot (replaces the status dot): same
 * busy/idle lighting as the dot, but via SVG color + drop-shadow so it stays
 * readable when the rail is collapsed.
 */
export function sessionFavoriteStarStyle(
  workspace: WorkspaceColorSource,
  busy: boolean | undefined
): Record<string, string> {
  const color = workspaceColor(workspace);
  if (busy) {
    return {
      color,
      filter: `drop-shadow(0 0 3px color-mix(in oklab, ${color} 45%, transparent))`
    };
  }
  return { color: idleStatusColor(color) };
}

/**
 * Finished/unread "Done" pill tinted with the workspace color (not accent).
 * Matches the collapsed sidebar checkmark so both states share identity color.
 */
export function sessionUnreadDoneStyle(
  workspace: WorkspaceColorSource
): Record<string, string> {
  const color = workspaceColor(workspace);
  return {
    color,
    borderColor: `color-mix(in oklab, ${color} 40%, transparent)`,
    background: `color-mix(in oklab, ${color} 14%, transparent)`
  };
}
