/**
 * Unified-diff rows for ACP `diff` tool content (Edit/Write tool calls),
 * rendered by ChatToolDiff.vue with the shared `diff-row--*` classes.
 */

// node_modules
import { structuredPatch } from 'diff';

// types
import type { ToolDiff } from './chatDisplayTypes';

// ---------------------------------- Types ----------------------------------

interface ToolDiffRow {
  text: string;
  className: string;
}

export interface ToolDiffView {
  path: string;
  fileName: string;
  directory: string;
  added: number;
  removed: number;
  /** Diff body lines (added, removed, context) — hunk headers not counted. */
  lineCount: number;
  rows: ToolDiffRow[];
}

// ---------------------------------- Constants ----------------------------------

/** Diffs with more lines than this (across all entries of a tool call) start collapsed. */
export const TOOL_DIFF_COLLAPSE_LINE_LIMIT = 40;

const TOOL_DIFF_CONTEXT_LINES = 3;

// ---------------------------------- Helpers ----------------------------------

function toolDiffRowClass(line: string): string {
  if (line.startsWith('+')) {
    return 'diff-row--added';
  }
  if (line.startsWith('-')) {
    return 'diff-row--removed';
  }
  if (line.startsWith('\\')) {
    return 'diff-row--meta';
  }
  return '';
}

/** Hunk rows for one diff entry; `oldText: null` (new file) renders as all-added lines. */
export function buildToolDiffView(diff: ToolDiff): ToolDiffView {
  const patch = structuredPatch(diff.path, diff.path, diff.oldText ?? '', diff.newText, undefined, undefined, {
    context: TOOL_DIFF_CONTEXT_LINES
  });
  const rows: ToolDiffRow[] = [];
  let added = 0;
  let removed = 0;
  let lineCount = 0;
  for (const hunk of patch.hunks) {
    rows.push({
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      className: 'diff-row--hunk'
    });
    for (const line of hunk.lines) {
      const className = toolDiffRowClass(line);
      if (className === 'diff-row--added') {
        added++;
      } else if (className === 'diff-row--removed') {
        removed++;
      }
      if (className !== 'diff-row--meta') {
        lineCount++;
      }
      rows.push({ text: line, className });
    }
  }
  const separatorIndex = diff.path.lastIndexOf('/');
  return {
    path: diff.path,
    fileName: diff.path.slice(separatorIndex + 1),
    directory: separatorIndex >= 0 ? diff.path.slice(0, separatorIndex + 1) : '',
    added,
    removed,
    lineCount,
    rows
  };
}
