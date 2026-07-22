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
  normalizePlanSearchText,
  planDocumentFromFileSummary,
  planDocumentFromItem,
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

  // -------------------------------------------------- Computed --------------------------------------------------

  const planDocuments = computed<PlanDocument[]>(() => {
    const docs: PlanDocument[] = [];
    const seenMarkdown = new Map<string, number>();
    const addPlanDocument = (doc: PlanDocument | null): void => {
      if (!doc) return;
      const key = normalizePlanSearchText(doc.markdown);
      if (key && seenMarkdown.has(key)) {
        const existing = docs[seenMarkdown.get(key)!];
        if (doc.backendPlanId && !existing.backendPlanId) {
          existing.backendPlanId = doc.backendPlanId;
          existing.planSourceSessionId = doc.planSourceSessionId ?? existing.planSourceSessionId;
        }
        return;
      }
      if (key) seenMarkdown.set(key, docs.length);
      docs.push(doc);
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

  function shortPlanEntry(content: string): string {
    return content.replace(/\s+/g, ' ').trim();
  }

  function resolvePlanLinkMeta(plan: PlanDocument): {
    backendPlanId?: string;
    planSourceSessionId?: string;
  } {
    return {
      backendPlanId: plan.backendPlanId,
      planSourceSessionId: plan.planSourceSessionId ?? ctx.session.value?.sessionId ?? undefined
    };
  }

  function startSessionFromFullPlan(plan: PlanDocument | null): void {
    if (!plan?.markdown.trim()) return;

    const { backendPlanId, planSourceSessionId } = resolvePlanLinkMeta(plan);
    const linkedPlanContext =
      backendPlanId && planSourceSessionId
        ? {
            sourceSessionId: ctx.sessionId(),
            sourceAcpSessionId: planSourceSessionId,
            planId: backendPlanId,
            planTitle: plan.title,
            entryIndex: 0,
            entryContent: plan.title,
            contextMode: 'full' as const
          }
        : undefined;

    ctx.onStartPlanSession({
      defaultName: `Plan: ${plan.title.slice(0, 80)}`,
      draftPrompt: linkedPlanContext
        ? `Implement the linked plan "${plan.title}".`
        : `Implement this plan:\n\n${plan.markdown.trim()}`,
      linkedPlanContext,
      defaultAgentType: ctx.session.value?.agentType,
      defaultModelSelection: ctx.modelSelection.value,
      defaultSessionMode: 'agent'
    });
  }

  function startSessionFromPlanEntry(plan: PlanDocument, entry: PlanEntry, index: number): void {
    const entryText = entry.content.trim();
    if (!entryText) return;

    const pointNumber = index + 1;
    const { backendPlanId, planSourceSessionId } = resolvePlanLinkMeta(plan);
    const linkedPlanContext =
      backendPlanId && planSourceSessionId
        ? {
            sourceSessionId: ctx.sessionId(),
            sourceAcpSessionId: planSourceSessionId,
            planId: backendPlanId,
            planTitle: plan.title,
            entryIndex: index,
            entryContent: entryText,
            contextMode: 'target-only' as const
          }
        : undefined;

    ctx.onStartPlanSession({
      defaultName: `Point ${pointNumber}: ${shortPlanEntry(entryText).slice(0, 80)}`,
      draftPrompt: linkedPlanContext
        ? `Implement point ${pointNumber} from the linked plan.`
        : `Implement point ${pointNumber} from "${plan.title}":\n\n${entryText}`,
      linkedPlanContext,
      defaultAgentType: ctx.session.value?.agentType,
      defaultModelSelection: ctx.modelSelection.value,
      defaultSessionMode: 'agent'
    });
  }

  function onPlanMarkdownClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest<HTMLButtonElement>('[data-plan-entry-index]');
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
    startSessionFromFullPlan,
    startSessionFromPlanEntry,
    onPlanMarkdownClick,
    resetPlanDocuments
  };
}

export type UsePlanDocuments = ReturnType<typeof usePlanDocuments>;
