/**
 * Plan documents pipeline — derives PlanDocuments from chat display items +
 * server-side plan files, with selection, refresh scheduling, and
 * start-session-from-plan actions.
 * Extracted from SessionChat.vue (previously ~530 lines inline).
 */

// node_modules
import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue';

// classes
import { sessionsApi } from '@/classes/api';

// utils
import {
  bestPlanMarkdownFallback,
  entriesFromPlanMarkdown,
  isPlanContentDone,
  isPlanEntryDone,
  markPlanEntryDoneInMarkdown,
  markdownFromPlanEntries,
  normalizePlanSearchText,
  PLAN_DONE_SUFFIX,
  planDocumentFromFileSummary,
  planDocumentFromItem,
  planMarkdownBaseKey,
  planEntryLabels,
  planMarkdownCandidatesFromDocuments,
  type PlanDocument,
  type PlanEntry
} from '@/utils/chatDisplayItems';

// types
import type { LinkedPlanContext, Session } from '@/@types/index';
import type { DisplayItem } from '@/utils/chatDisplayItems';

// -------------------------------------------------- Types --------------------------------------------------

export interface DisplayChatMessage {
  msg: { createdAt: string };
  key: string;
  items: DisplayItem[];
  fallbackHtml: string;
}

export interface StartPlanSessionPayload {
  defaultName: string;
  draftPrompt: string;
  linkedPlanContext?: LinkedPlanContext;
  defaultAgentType?: Session['agentType'];
  defaultModelSelection?: string;
  defaultSessionMode?: string;
}

export interface UsePlanDocumentsContext {
  workspaceId: () => string;
  sessionId: () => string;
  session: Ref<Session | null>;
  displayMessages: ComputedRef<DisplayChatMessage[]>;
  streamingDisplayItems: ComputedRef<DisplayItem[]>;
  activeTab: Ref<string>;
  modelSelection: Ref<string>;
  onStartPlanSession: (payload: StartPlanSessionPayload) => void;
}

export function usePlanDocuments(ctx: UsePlanDocumentsContext) {
  // -------------------------------------------------- Refs --------------------------------------------------
  const selectedPlanId = ref<string | null>(null);
  const planDocumentsRefreshTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Backend plan ids / markdown keys removed this session so chat copies don't reappear. */
  const dismissedPlanKeys = ref(new Set<string>());
  /**
   * Optimistic markdown overrides for the current page view only.
   * Durable persistence is an ACP `sessionUpdate: plan` event in chat history
   * (same path Claude ACP uses), not sessionConfigJson (__nova keys are stripped
   * from API responses).
   */
  const planMarkdownOverrides = ref(new Map<string, string>());
  /** Keeps plan persists in click order; each one carries the cumulative markdown. */
  let planPersistChain: Promise<unknown> = Promise.resolve();

  function lookupPlanMarkdownOverride(
    doc: PlanDocument,
    overrides: Map<string, string>
  ): string | undefined {
    return (
      overrides.get(doc.id) ??
      (doc.backendPlanId ? overrides.get(doc.backendPlanId) : undefined) ??
      overrides.get(`base:${planMarkdownBaseKey(doc.markdown)}`)
    );
  }

  // -------------------------------------------------- Computed --------------------------------------------------

  const planDocuments = computed<PlanDocument[]>(() => {
    const docs: PlanDocument[] = [];
    const seenMarkdown = new Map<string, number>();
    const dismissed = dismissedPlanKeys.value;
    const overrides = planMarkdownOverrides.value;
    const applyMarkdownOverride = (doc: PlanDocument | null): PlanDocument | null => {
      if (!doc) return null;
      const override = lookupPlanMarkdownOverride(doc, overrides);
      if (!override || override === doc.markdown) return doc;
      if (doc.backendPlanId) {
        const rebuilt = planDocumentFromFileSummary(
          {
            id: doc.backendPlanId,
            sessionId: doc.planSourceSessionId ?? '',
            title: doc.title,
            markdown: override
          },
          0
        );
        return rebuilt
          ? { ...rebuilt, id: doc.id, createdAt: doc.createdAt, live: doc.live }
          : { ...doc, markdown: override };
      }
      // Re-parse from overridden markdown so " - done" suffixes update entries.
      const rebuilt = planDocumentFromItem(
        {
          kind: 'plan',
          planId: doc.id,
          planTitle: doc.title,
          planMarkdown: override,
          planSourceSessionId: doc.planSourceSessionId
        },
        doc.id,
        0,
        doc.createdAt,
        doc.live
      );
      return rebuilt ?? { ...doc, markdown: override };
    };
    const addPlanDocument = (doc: PlanDocument | null): void => {
      const resolved = applyMarkdownOverride(doc);
      if (!resolved) return;
      const key = normalizePlanSearchText(resolved.markdown);
      if (
        dismissed.has(`id:${resolved.id}`) ||
        (resolved.backendPlanId && dismissed.has(`id:${resolved.backendPlanId}`)) ||
        (key && dismissed.has(`md:${key}`))
      ) {
        return;
      }
      // Prefer the version that already includes done markers / more markdown.
      const baseKey = planMarkdownBaseKey(resolved.markdown);
      const dedupeKey = baseKey || key;
      if (dedupeKey && seenMarkdown.has(dedupeKey)) {
        const existing = docs[seenMarkdown.get(dedupeKey)!];
        if (resolved.backendPlanId && !existing.backendPlanId) {
          existing.backendPlanId = resolved.backendPlanId;
          existing.planSourceSessionId =
            resolved.planSourceSessionId ?? existing.planSourceSessionId;
        }
        const preferResolved =
          resolved.markdown.length > existing.markdown.length ||
          resolved.completedCount > existing.completedCount ||
          (Boolean(resolved.backendPlanId) && !existing.backendPlanId);
        if (preferResolved) {
          docs[seenMarkdown.get(dedupeKey)!] = {
            ...resolved,
            id: existing.id,
            createdAt: existing.createdAt || resolved.createdAt,
            live: existing.live || resolved.live
          };
        }
        return;
      }
      if (dedupeKey) seenMarkdown.set(dedupeKey, docs.length);
      docs.push(resolved);
    };
    const filePlanDocuments = ctx.session.value?.planDocuments;
    for (const { msg, items, key } of ctx.displayMessages.value) {
      let planIndex = 0;
      for (const item of items) {
        if (item.kind !== 'plan') continue;
        const fileMarkdownCandidates = planMarkdownCandidatesFromDocuments(
          filePlanDocuments,
          item.planSourceSessionId
        );
        const doc = planDocumentFromItem(
          item,
          item.planId ?? `${key}-plan-${planIndex}`,
          planIndex,
          msg.createdAt,
          false,
          bestPlanMarkdownFallback(item, fileMarkdownCandidates)
        );
        addPlanDocument(doc);
        planIndex += 1;
      }
    }
    let livePlanIndex = 0;
    for (const item of ctx.streamingDisplayItems.value) {
      if (item.kind !== 'plan') continue;
      const fileMarkdownCandidates = planMarkdownCandidatesFromDocuments(
        filePlanDocuments,
        item.planSourceSessionId
      );
      const doc = planDocumentFromItem(
        item,
        item.planId ?? `live-plan-${livePlanIndex}`,
        livePlanIndex,
        new Date().toISOString(),
        true,
        bestPlanMarkdownFallback(item, fileMarkdownCandidates)
      );
      addPlanDocument(doc);
      livePlanIndex += 1;
    }
    filePlanDocuments?.forEach((doc, index) => addPlanDocument(planDocumentFromFileSummary(doc, index)));
    return docs;
  });

  const selectedPlanDocument = computed<PlanDocument | null>(() => {
    if (selectedPlanId.value) {
      const selected = planDocuments.value.find((doc) => doc.id === selectedPlanId.value);
      if (selected) return selected;
    }
    return planDocuments.value[planDocuments.value.length - 1] ?? null;
  });

  const latestPlanDocumentId = computed(() => planDocuments.value.at(-1)?.id ?? null);

  const bShowPlanTab = computed(
    () => ctx.activeTab.value === 'plan' || planDocuments.value.length > 0
  );

  // -------------------------------------------------- Watchers --------------------------------------------------

  watch(latestPlanDocumentId, (latestId, previousId) => {
    if (!latestId || latestId === previousId || ctx.activeTab.value !== 'plan') return;
    selectedPlanId.value = latestId;
  });

  // -------------------------------------------------- Methods --------------------------------------------------

  function openPlan(planId: string | undefined): void {
    if (planId) selectedPlanId.value = planId;
    ctx.activeTab.value = 'plan';
  }

  async function refreshPlanDocuments(opts: { selectLatest?: boolean } = {}): Promise<void> {
    try {
      const response = await sessionsApi.get(ctx.workspaceId(), ctx.sessionId());
      if (!ctx.session.value || response.data.id !== ctx.session.value.id) return;
      // Disk/API is source of truth — drop optimistic mark-as-done overrides.
      planMarkdownOverrides.value = new Map();
      ctx.session.value = {
        ...ctx.session.value,
        planDocuments: response.data.planDocuments ?? []
      };
      if (opts.selectLatest) {
        await nextTick();
        const latestId = latestPlanDocumentId.value;
        if (latestId) selectedPlanId.value = latestId;
      }
    } catch {
      // plan documents refresh opportunistically on the next run
    }
  }

  function schedulePlanDocumentsRefresh(delayMs: number, opts: { selectLatest?: boolean } = {}): void {
    const timer = setTimeout(() => {
      planDocumentsRefreshTimers.delete(timer);
      void refreshPlanDocuments(opts);
    }, delayMs);
    planDocumentsRefreshTimers.add(timer);
  }

  function clearPlanDocumentsRefreshTimers(): void {
    for (const timer of planDocumentsRefreshTimers) {
      clearTimeout(timer);
    }
    planDocumentsRefreshTimers.clear();
  }

  function safeDownloadName(value: string): string {
    const base = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `${base || 'plan'}.plan.md`;
  }

  function downloadPlan(plan: PlanDocument | null): void {
    if (!plan?.markdown.trim()) return;
    const blob = new Blob([`${plan.markdown.trim()}\n`], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeDownloadName(plan.title);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function dismissPlanFromList(plan: PlanDocument): void {
    const next = new Set(dismissedPlanKeys.value);
    if (plan.backendPlanId) next.add(`id:${plan.backendPlanId}`);
    const key = normalizePlanSearchText(plan.markdown);
    if (key) next.add(`md:${key}`);
    next.add(`id:${plan.id}`);
    dismissedPlanKeys.value = next;
  }

  async function deletePlan(plan: PlanDocument | null): Promise<boolean> {
    if (!plan) return false;
    if (plan.backendPlanId) {
      await sessionsApi.deletePlanDocument(ctx.workspaceId(), ctx.sessionId(), plan.backendPlanId);
      if (ctx.session.value?.planDocuments) {
        ctx.session.value = {
          ...ctx.session.value,
          planDocuments: ctx.session.value.planDocuments.filter(
            (doc) => doc.id !== plan.backendPlanId
          )
        };
      }
    }
    dismissPlanFromList(plan);
    await nextTick();
    const remaining = planDocuments.value;
    if (!remaining.some((doc) => doc.id === selectedPlanId.value)) {
      selectedPlanId.value = remaining.at(-1)?.id ?? null;
    }
    return true;
  }

  function shortPlanEntry(content: string): string {
    return content.replace(/\s+/g, ' ').trim();
  }

  function resolvePlanLinkMeta(plan: PlanDocument): {
    planId: string;
    planSourceSessionId: string;
    sourceAgentType?: Session['agentType'];
    planMarkdown?: string;
  } {
    const planSourceSessionId =
      plan.planSourceSessionId ?? ctx.session.value?.sessionId ?? 'inline';
    const planMarkdown = plan.markdown.trim() || undefined;
    return {
      // File-backed ids when present; otherwise the UI plan id (Claude stream plans).
      planId: plan.backendPlanId ?? plan.id,
      planSourceSessionId,
      sourceAgentType: ctx.session.value?.agentType ?? undefined,
      // Embed markdown so linked sessions still see the full plan even if the
      // file is missing or the target agent has no file-backed plan source.
      ...(planMarkdown ? { planMarkdown } : {})
    };
  }

  function startSessionFromFullPlan(plan: PlanDocument | null): void {
    if (!plan?.markdown.trim()) return;

    const { planId, planSourceSessionId, sourceAgentType, planMarkdown } = resolvePlanLinkMeta(plan);
    const linkedPlanContext: LinkedPlanContext = {
      sourceSessionId: ctx.sessionId(),
      sourceAcpSessionId: planSourceSessionId,
      planId,
      planTitle: plan.title,
      entryIndex: 0,
      entryContent: plan.title,
      contextMode: 'full',
      ...(sourceAgentType ? { sourceAgentType } : {}),
      ...(planMarkdown ? { planMarkdown } : {})
    };

    ctx.onStartPlanSession({
      defaultName: `Plan: ${plan.title.slice(0, 80)}`,
      draftPrompt: `Implement the linked plan "${plan.title}".`,
      linkedPlanContext,
      defaultAgentType: ctx.session.value?.agentType,
      defaultModelSelection: ctx.modelSelection.value,
      defaultSessionMode: 'agent'
    });
  }

  function startSessionFromPlanEntry(plan: PlanDocument, entry: PlanEntry, index: number): void {
    const entryText = entry.content.trim();
    if (!entryText) return;

    const labels = planEntryLabels(plan.markdown);
    const pointNumber =
      labels.length === plan.startableEntries.length ? labels[index] : String(index + 1);
    const { planId, planSourceSessionId, sourceAgentType, planMarkdown } = resolvePlanLinkMeta(plan);
    const linkedPlanContext: LinkedPlanContext = {
      sourceSessionId: ctx.sessionId(),
      sourceAcpSessionId: planSourceSessionId,
      planId,
      planTitle: plan.title,
      entryIndex: index,
      entryLabel: pointNumber,
      entryContent: entryText,
      // Include full plan markdown when available so the implementer sees surrounding context
      // even for agents (Claude) that have no file-backed plan documents.
      contextMode: planMarkdown ? 'full' : 'target-only',
      ...(sourceAgentType ? { sourceAgentType } : {}),
      ...(planMarkdown ? { planMarkdown } : {})
    };

    ctx.onStartPlanSession({
      defaultName: `Point ${pointNumber}: ${shortPlanEntry(entryText).slice(0, 80)}`,
      draftPrompt: `Implement point ${pointNumber} from the linked plan.`,
      linkedPlanContext,
      defaultAgentType: ctx.session.value?.agentType,
      defaultModelSelection: ctx.modelSelection.value,
      defaultSessionMode: 'agent'
    });
  }

  function setPlanMarkdownOverride(plan: PlanDocument, markdown: string): void {
    const next = new Map(planMarkdownOverrides.value);
    next.set(plan.id, markdown);
    if (plan.backendPlanId) next.set(plan.backendPlanId, markdown);
    const baseKey = planMarkdownBaseKey(markdown) || planMarkdownBaseKey(plan.markdown);
    if (baseKey) next.set(`base:${baseKey}`, markdown);
    planMarkdownOverrides.value = next;
  }

  async function markPlanEntryDone(
    plan: PlanDocument,
    _entry: PlanEntry,
    index: number
  ): Promise<void> {
    const markedMarkdown = markPlanEntryDoneInMarkdown(plan.markdown, index);
    const nextEntries: PlanEntry[] = plan.startableEntries.map((entry, i) => {
      if (i === index) {
        const content = isPlanContentDone(entry.content)
          ? entry.content
          : `${entry.content.trimEnd()}${PLAN_DONE_SUFFIX}`;
        return { content, status: 'completed' };
      }
      return {
        content: entry.content,
        status: isPlanEntryDone(entry) ? 'completed' : entry.status
      };
    });
    const nextMarkdown =
      markedMarkdown ??
      (plan.markdown.trim() ? plan.markdown : markdownFromPlanEntries(nextEntries));
    if (!nextMarkdown.trim() && nextEntries.length === 0) return;

    // Prefer entries derived from the edited markdown when the line edit landed.
    const persistEntries = markedMarkdown
      ? entriesFromPlanMarkdown(markedMarkdown).map((entry) => ({
          content: entry.content,
          status: isPlanEntryDone(entry) ? 'completed' : entry.status,
          priority: 'medium'
        }))
      : nextEntries.map((entry) => ({
          content: entry.content,
          status: entry.status,
          priority: 'medium'
        }));

    setPlanMarkdownOverride(plan, nextMarkdown);

    const workspaceId = ctx.workspaceId();
    const sessionId = ctx.sessionId();
    const request = planPersistChain.then(() =>
      sessionsApi.persistPlanUpdate(workspaceId, sessionId, {
        title: plan.title,
        markdown: nextMarkdown,
        entries: persistEntries,
        ...(plan.backendPlanId ? { planId: plan.backendPlanId } : {})
      })
    );
    planPersistChain = request.catch(() => undefined);
    try {
      await request;
    } catch (err) {
      console.error('Failed to persist plan mark-as-done', err);
      if (ctx.sessionId() === sessionId) setPlanMarkdownOverride(plan, plan.markdown);
      return;
    }

    if (plan.backendPlanId && ctx.session.value?.planDocuments) {
      ctx.session.value = {
        ...ctx.session.value,
        planDocuments: ctx.session.value.planDocuments.map((doc) =>
          doc.id === plan.backendPlanId ? { ...doc, markdown: nextMarkdown } : doc
        )
      };
    }
    // Reload file-backed plans so Claude/Cursor disk (with " - done") is authoritative.
    schedulePlanDocumentsRefresh(100);
  }

  function onPlanMarkdownClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    // Open http(s) links outside the PWA (standalone often keeps target=_blank in-app).
    const anchor = target.closest('a');
    if (
      anchor instanceof HTMLAnchorElement &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      const href = anchor.href;
      if (/^https?:\/\//i.test(href)) {
        event.preventDefault();
        event.stopPropagation();
        window.open(href, '_blank', 'noopener,noreferrer');
        return;
      }
    }

    const markDoneButton = target.closest<HTMLButtonElement>('[data-plan-mark-done]');
    if (markDoneButton) {
      const plan = selectedPlanDocument.value;
      const index = Number(markDoneButton.dataset.planMarkDone);
      const entry = Number.isFinite(index) ? plan?.startableEntries[index] : undefined;
      if (plan && entry) void markPlanEntryDone(plan, entry, index);
      return;
    }

    const button = target.closest<HTMLButtonElement>('button.plan-start-session-btn');
    if (!button) return;

    const plan = selectedPlanDocument.value;
    if (button.dataset.planFullPlan === 'true') {
      startSessionFromFullPlan(plan);
      return;
    }

    const index = Number(button.dataset.planEntryIndex);
    const entry = Number.isFinite(index) ? plan?.startableEntries[index] : undefined;
    if (plan && entry) {
      startSessionFromPlanEntry(plan, entry, index);
    }
  }

  function resetPlanDocuments(): void {
    clearPlanDocumentsRefreshTimers();
    selectedPlanId.value = null;
    dismissedPlanKeys.value = new Set();
    planMarkdownOverrides.value = new Map();
  }

  // -------------------------------------------------- Export --------------------------------------------------
  return {
    // data
    selectedPlanId,
    planDocuments,
    selectedPlanDocument,
    latestPlanDocumentId,
    bShowPlanTab,
    // methods
    openPlan,
    refreshPlanDocuments,
    schedulePlanDocumentsRefresh,
    clearPlanDocumentsRefreshTimers,
    downloadPlan,
    deletePlan,
    markPlanEntryDone,
    startSessionFromFullPlan,
    startSessionFromPlanEntry,
    onPlanMarkdownClick,
    resetPlanDocuments
  };
}

export type UsePlanDocuments = ReturnType<typeof usePlanDocuments>;
