/**
 * Shared display-item types for the chat pipeline (chatDisplayItems,
 * planDocuments). Kept separate so those modules don't import each other.
 */

// types
import type { TodoDisplayItem } from '@novacode/shared';

// ---------------------------------- Types ----------------------------------

export interface PlanEntry {
  content: string;
  status: string;
}

export interface DisplayItem {
  kind: 'text' | 'tool' | 'todos' | 'plan' | 'notice';
  // text
  text?: string;
  renderedHtml?: string;
  // tool
  callId?: string;
  toolName?: string;
  toolIcon?: string;
  toolSummary?: string;
  status?: 'running' | 'success' | 'rejected';
  locations?: Array<{ path: string; line?: number }>;
  toolOutput?: string;
  /** Image file the tool returned (e.g. Read on a JPEG) — shown from disk on demand. */
  toolImagePath?: string;
  // todos
  todoItems?: TodoDisplayItem[];
  todoDoneCount?: number;
  // plan (ACP native)
  planId?: string;
  planSourceSessionId?: string;
  planTitle?: string;
  planMarkdown?: string;
  planEntries?: PlanEntry[];
  planCompletedCount?: number;
  planRenderedHtml?: string;
}
