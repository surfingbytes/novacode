/**
 * Plan entries and plan documents — parses plan markdown into startable
 * entries and renders it with per-step actions.
 */

// types
import type { PlanDocumentSummary } from '@/@types/index';
import type { DisplayItem, PlanEntry } from './chatDisplayTypes';

// utils
import { renderMdCached } from './chatMarkdown';

// ---------------------------------- Types ----------------------------------

export interface PlanDocument {
  id: string;
  backendPlanId?: string;
  planSourceSessionId?: string;
  title: string;
  markdown: string;
  entries: PlanEntry[];
  startableEntries: PlanEntry[];
  completedCount: number;
  renderedHtml: string;
  createdAt: string;
  live: boolean;
}

// ---------------------------------- Plan entries ----------------------------------

/** Suffix appended to a plan step name when the user marks it done. */
export const PLAN_DONE_SUFFIX = ' - done';

export function isPlanContentDone(content: string | undefined): boolean {
  return Boolean(content?.trimEnd().endsWith(PLAN_DONE_SUFFIX));
}

export function isPlanEntryCompleted(status: string | undefined): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return (
    normalized === 'completed' || normalized === 'done' || normalized === 'todo_status_completed'
  );
}

/** True when the entry is completed via ACP status or the " - done" name suffix. */
export function isPlanEntryDone(entry: Pick<PlanEntry, 'content' | 'status'>): boolean {
  return isPlanEntryCompleted(entry.status) || isPlanContentDone(entry.content);
}

function isPlanEntryInProgress(status: string | undefined): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return (
    normalized === 'in_progress' ||
    normalized === 'in-progress' ||
    normalized === 'running' ||
    normalized === 'todo_status_in_progress'
  );
}

export function planStatusIcon(
  status: string | undefined
): 'completed' | 'in_progress' | 'pending' {
  if (isPlanEntryCompleted(status)) return 'completed';
  if (isPlanEntryInProgress(status)) return 'in_progress';
  return 'pending';
}

function escapePlanEntryContent(content: string): string {
  return content.replace(/\r\n/g, '\n').trim();
}

export function markdownFromPlanEntries(entries: PlanEntry[]): string {
  if (entries.length === 0) return '';
  return entries
    .map((entry) => {
      const box = isPlanEntryCompleted(entry.status) ? 'x' : ' ';
      const content = escapePlanEntryContent(entry.content).replace(/\n/g, '\n  ');
      return `- [${box}] ${content}`;
    })
    .join('\n');
}

// ---------------------------------- Plan documents ----------------------------------

function stripMarkdownSyntax(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function unwrapMarkdownFence(markdown: string): string {
  const trimmed = markdown.trim();
  const match = trimmed.match(/^```(?:md|markdown)?\s*\n([\s\S]*?)\n```$/i);
  return (match?.[1] ?? trimmed).trim();
}

export function entriesFromPlanMarkdown(markdown: string): PlanEntry[] {
  const lines = unwrapMarkdownFence(markdown).replace(/\r\n/g, '\n').split('\n');
  const headingEntries: PlanEntry[] = [];
  const actionEntries: PlanEntry[] = [];
  const numberedEntries: PlanEntry[] = [];
  let inFence = false;
  let fenceMarker: '`' | '~' | null = null;

  const addEntry = (target: PlanEntry[], content: string): PlanEntry => {
    const existing = [...headingEntries, ...actionEntries].find(
      (entry) => entry.content === content
    );
    if (existing) return existing;
    const entry = {
      content,
      status: isPlanContentDone(content) ? 'completed' : 'pending'
    };
    target.push(entry);
    return entry;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~';
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }
    if (inFence) continue;

    const headingMatch = line.match(/^#{1,4}\s+(?:\d+[\.)]\s*)?(.+)$/);
    const orderedMatch = line.match(/^\s{0,3}\d+[\.)]\s+(.+)$/);
    const taskMatch = line.match(/^\s{0,3}[-*]\s+\[[ xX]\]\s+(.+)$/);
    const bNumberedEntry = Boolean(orderedMatch || /^#{1,4}\s+\d+[\.)]\s+/.test(line));
    const rawContent = headingMatch?.[1] ?? orderedMatch?.[1] ?? taskMatch?.[1];
    const content = rawContent ? stripMarkdownSyntax(rawContent) : '';
    if (!content) continue;

    const entry = addEntry(orderedMatch || taskMatch ? actionEntries : headingEntries, content);
    if (bNumberedEntry) numberedEntries.push(entry);
  }

  return numberedEntries.length
    ? numberedEntries
    : actionEntries.length
      ? actionEntries
      : headingEntries;
}

function planActionTargetKind(
  line: string,
  hasNumberedEntries: boolean
): 'full-plan' | 'entry' | null {
  const bNumberedLine = /^#{1,4}\s+\d+[\.)]\s+/.test(line) || /^\s{0,3}\d+[\.)]\s+/.test(line);
  const bTaskLine = /^\s{0,3}[-*]\s+\[[ xX]\]\s+/.test(line);
  const bHeadingLine = /^#{1,4}\s+/.test(line);
  const bActionTarget = hasNumberedEntries
    ? bNumberedLine
    : bNumberedLine || bTaskLine || bHeadingLine;
  if (!bActionTarget) return null;
  if (bHeadingLine && !bNumberedLine && !bTaskLine) return 'full-plan';
  return 'entry';
}

/** Appends " - done" to the Nth startable plan entry line in markdown. */
export function markPlanEntryDoneInMarkdown(markdown: string, entryIndex: number): string | null {
  if (entryIndex < 0) return null;
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const hasNumberedEntries = lines.some(
    (line) => /^#{1,4}\s+\d+[\.)]\s+/.test(line) || /^\s{0,3}\d+[\.)]\s+/.test(line)
  );
  let inFence = false;
  let fenceMarker: '`' | '~' | null = null;
  let currentEntry = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trimEnd();
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~';
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }
    if (inFence) continue;
    if (planActionTargetKind(line, hasNumberedEntries) !== 'entry') continue;
    if (currentEntry !== entryIndex) {
      currentEntry += 1;
      continue;
    }
    if (isPlanContentDone(stripMarkdownSyntax(line))) return null;
    lines[i] = `${lines[i].trimEnd()}${PLAN_DONE_SUFFIX}`;
    return lines.join('\n');
  }
  return null;
}

/** List-item steps nest under any heading step. */
const PLAN_LIST_STEP_LEVEL = 10;

interface PlanLineInfo {
  rawLine: string;
  kind: 'entry' | 'full-plan' | 'heading' | 'text';
  /** Heading depth (1-4) or PLAN_LIST_STEP_LEVEL for list steps; 0 for plain text. */
  level: number;
}

function scanPlanLines(markdown: string): PlanLineInfo[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const hasNumberedEntries = lines.some(
    (line) => /^#{1,4}\s+\d+[\.)]\s+/.test(line) || /^\s{0,3}\d+[\.)]\s+/.test(line)
  );
  let inFence = false;
  let fenceMarker: '`' | '~' | null = null;

  return lines.map((rawLine) => {
    const line = rawLine.trimEnd();
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~';
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = null;
      }
      return { rawLine, kind: 'text', level: 0 };
    }
    if (inFence) return { rawLine, kind: 'text', level: 0 };

    const headingLevel = line.match(/^(#{1,4})\s+/)?.[1].length ?? 0;
    const kind = planActionTargetKind(line, hasNumberedEntries);
    if (kind === 'entry') {
      return { rawLine, kind, level: headingLevel || PLAN_LIST_STEP_LEVEL };
    }
    if (kind === 'full-plan') return { rawLine, kind, level: headingLevel };
    if (headingLevel) return { rawLine, kind: 'heading', level: headingLevel };
    return { rawLine, kind: 'text', level: 0 };
  });
}

/** Parent step index for each startable entry (-1 for top-level steps). */
export function planEntryParentIndexes(markdown: string): number[] {
  const parents: number[] = [];
  const stack: Array<{ index: number; level: number }> = [];
  for (const info of scanPlanLines(markdown)) {
    if (info.kind === 'text') continue;
    while (stack.length && stack[stack.length - 1].level >= info.level) stack.pop();
    if (info.kind !== 'entry') continue;
    parents.push(stack.length ? stack[stack.length - 1].index : -1);
    stack.push({ index: parents.length - 1, level: info.level });
  }
  return parents;
}

/**
 * Hierarchical label per startable entry ("6", "5.3"), using the number written
 * in the markdown when present, else the position among siblings.
 */
export function planEntryLabels(markdown: string): string[] {
  const labels: string[] = [];
  const stack: Array<{ level: number; label: string; childCount: number }> = [];
  let topLevelCount = 0;
  for (const info of scanPlanLines(markdown)) {
    if (info.kind === 'text') continue;
    while (stack.length && stack[stack.length - 1].level >= info.level) stack.pop();
    if (info.kind !== 'entry') continue;
    const parent = stack[stack.length - 1];
    const ordinal = parent ? ++parent.childCount : ++topLevelCount;
    const written = info.rawLine.match(/^\s*(?:#{1,4}\s+)?(\d+)[.)]\s/)?.[1];
    const own = written ?? String(ordinal);
    const label = parent ? `${parent.label}.${own}` : own;
    labels.push(label);
    stack.push({ level: info.level, label, childCount: 0 });
  }
  return labels;
}

export function renderPlanMarkdownWithActions(markdown: string, entries: PlanEntry[]): string {
  if (!entries.length) return renderMdCached(markdown);

  const out: string[] = [];
  let entryIndex = 0;
  const openLevels: number[] = [];

  // Close steps at or below `level` so substeps stay inside their parent's body.
  const closeStepsFrom = (level: number): void => {
    while (openLevels.length && openLevels[openLevels.length - 1] >= level) {
      openLevels.pop();
      out.push('', '</div>', '', '</div>', '');
    }
  };

  for (const { rawLine, kind, level } of scanPlanLines(markdown)) {
    if (kind === 'heading') {
      closeStepsFrom(level);
    } else if (kind === 'full-plan') {
      closeStepsFrom(level);
      out.push(rawLine);
      out.push(
        '',
        `<div class="plan-start-action-inline"><button type="button" class="plan-start-session-btn" data-plan-entry-index="${entryIndex}" data-plan-full-plan="true">Start session</button></div>`,
        ''
      );
      continue;
    } else if (kind === 'entry' && entryIndex < entries.length) {
      closeStepsFrom(level);
      const done = isPlanEntryDone(entries[entryIndex]);
      out.push(
        '',
        `<div class="plan-step" data-plan-entry-index="${entryIndex}" data-plan-done="${done ? 'true' : 'false'}">`,
        '',
        '<div class="plan-step-title">',
        '',
        rawLine,
        '',
        '</div>',
        '',
        '<div class="plan-step-body">',
        ''
      );
      openLevels.push(level);
      const buttons = [
        `<button type="button" class="plan-start-session-btn" data-plan-entry-index="${entryIndex}">Start session</button>`
      ];
      if (!done) {
        buttons.push(
          `<button type="button" class="plan-mark-done-btn" data-plan-mark-done="${entryIndex}">Mark as done</button>`
        );
      }
      out.push(`<div class="plan-start-action-inline">${buttons.join('')}</div>`, '');
      entryIndex += 1;
      continue;
    }

    out.push(rawLine);
  }
  closeStepsFrom(0);

  return renderMdCached(out.join('\n'));
}

function planTitle(item: DisplayItem, fallbackIndex: number): string {
  const title = item.planTitle?.trim();
  if (title) return title;
  return fallbackIndex === 0 ? 'Plan' : `Plan ${fallbackIndex + 1}`;
}

export interface PlanMarkdownCandidate {
  markdown: string;
  normalized: string;
  index: number;
  planId?: string;
  sourceSessionId?: string;
}

export function normalizePlanSearchText(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Stable key for a plan body ignoring " - done" markers (for override lookup). */
export function planMarkdownBaseKey(markdown: string | undefined): string {
  return normalizePlanSearchText((markdown ?? '').replace(/(?:\s*-\s*done\b)/gi, ''));
}

function firstMarkdownHeading(markdown: string): string {
  const heading = unwrapMarkdownFence(markdown)
    .match(/^#{1,3}\s+(.+)$/m)?.[1]
    ?.trim();
  return heading ?? '';
}

function looksLikeFullPlanMarkdown(markdown: string | undefined): markdown is string {
  if (!markdown?.trim()) return false;
  const text = unwrapMarkdownFence(markdown);
  const headingCount = (text.match(/^#{1,3}\s+/gm) ?? []).length;
  const hasPlanSections =
    /^#{1,3}\s+(goal|required order|step\s+\d+|implementation|validation|test plan)\b/im.test(text);
  return headingCount >= 2 || (headingCount >= 1 && hasPlanSections);
}

export function planMarkdownCandidatesFromDocuments(
  documents: PlanDocumentSummary[] | undefined,
  sourceSessionId: string | undefined
): PlanMarkdownCandidate[] {
  if (!sourceSessionId || !documents?.length) return [];
  return documents
    .filter((doc) => doc.sessionId === sourceSessionId && looksLikeFullPlanMarkdown(doc.markdown))
    .map((doc, index) => {
      const markdown = unwrapMarkdownFence(doc.markdown);
      return {
        markdown,
        normalized: normalizePlanSearchText(
          `${doc.title} ${firstMarkdownHeading(markdown)} ${markdown}`
        ),
        index,
        planId: doc.id,
        sourceSessionId: doc.sessionId
      };
    });
}

function scorePlanMarkdownCandidate(item: DisplayItem, candidate: PlanMarkdownCandidate): number {
  const titleTokens = normalizePlanSearchText(item.planTitle)
    .split(' ')
    .filter((token) => token.length >= 3);
  const entryTokens = (item.planEntries ?? []).slice(0, 3).flatMap((entry) =>
    normalizePlanSearchText(entry.content)
      .split(' ')
      .filter((token) => token.length >= 4)
      .slice(0, 4)
  );
  const tokens = [...titleTokens, ...entryTokens];
  if (tokens.length === 0) return candidate.index;
  const matches = tokens.filter((token) => candidate.normalized.includes(token)).length;
  return matches * 1000 + candidate.index;
}

export function bestPlanMarkdownFallback(
  item: DisplayItem,
  candidates: PlanMarkdownCandidate[]
): PlanMarkdownCandidate | undefined {
  if (candidates.length === 0) return undefined;
  let best: PlanMarkdownCandidate | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = scorePlanMarkdownCandidate(item, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (!best) return undefined;
  if (bestScore > 0 || candidates.length === 1) return best;
  return undefined;
}

export function planDocumentFromItem(
  item: DisplayItem,
  id: string,
  fallbackIndex: number,
  createdAt: string,
  live: boolean,
  fallback?: PlanMarkdownCandidate
): PlanDocument | null {
  if (item.kind !== 'plan') return null;
  const entries = item.planEntries ?? [];
  const markdown =
    item.planMarkdown?.trim() || fallback?.markdown.trim() || markdownFromPlanEntries(entries);
  if (!markdown && entries.length === 0) return null;
  const startableEntries = (entries.length ? entries : entriesFromPlanMarkdown(markdown)).map(
    (entry) =>
      isPlanContentDone(entry.content) && !isPlanEntryCompleted(entry.status)
        ? { ...entry, status: 'completed' }
        : entry
  );
  const completedCount = startableEntries.filter((entry) => isPlanEntryDone(entry)).length;
  return {
    id,
    backendPlanId: fallback?.planId,
    planSourceSessionId: item.planSourceSessionId ?? fallback?.sourceSessionId,
    title: planTitle(item, fallbackIndex),
    markdown,
    entries,
    startableEntries,
    completedCount,
    renderedHtml: renderPlanMarkdownWithActions(markdown, startableEntries),
    createdAt,
    live
  };
}

export function planDocumentFromFileSummary(
  doc: PlanDocumentSummary,
  index: number
): PlanDocument | null {
  const markdown = doc.markdown.trim();
  if (!markdown) return null;
  const startableEntries = entriesFromPlanMarkdown(markdown);
  return {
    id: `file-plan-${doc.id}`,
    backendPlanId: doc.id,
    planSourceSessionId: doc.sessionId,
    title:
      doc.title || firstMarkdownHeading(markdown) || (index === 0 ? 'Plan' : `Plan ${index + 1}`),
    markdown,
    entries: [],
    startableEntries,
    completedCount: startableEntries.filter((entry) => isPlanEntryDone(entry)).length,
    renderedHtml: renderPlanMarkdownWithActions(markdown, startableEntries),
    createdAt: '',
    live: false
  };
}
