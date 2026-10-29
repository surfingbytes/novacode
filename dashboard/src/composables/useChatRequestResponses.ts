/**
 * ACP approval / ask_question responses: per-question option selections and
 * "answer sent, waiting for the server" marks (one response per request).
 * Extracted from ChatMessageList.vue.
 */

// node_modules
import { ref, watch } from 'vue';

// stores
import { useToastStore } from '@/stores/toasts';

// types
import type {
  ChatApprovalRequest,
  ChatQuestionAnswer,
  ChatQuestionRequest
} from '@/@types/index';

// -------------------------------------------------- Types --------------------------------------------------

/** questionRequestId -> questionId -> selected option ids */
export type QuestionSelections = Record<string, Record<string, string[]>>;

export interface ChatRequestResponsesSource {
  pendingApprovals: ChatApprovalRequest[];
  pendingQuestions: ChatQuestionRequest[];
  /** Returns false when the socket is down and nothing was sent */
  sendApprovalResponse: (approvalRequestId: string, approvalOptionId: string) => boolean;
  sendQuestionResponse: (
    questionRequestId: string,
    payload: { skipped: true } | { answers: ChatQuestionAnswer[] }
  ) => boolean;
}

// -------------------------------------------------- Helpers --------------------------------------------------

export function selectedQuestionOptionIds(
  selections: QuestionSelections,
  questionRequestId: string,
  questionId: string
): string[] {
  return selections[questionRequestId]?.[questionId] ?? [];
}

export function canSubmitQuestionRequest(
  selections: QuestionSelections,
  request: ChatQuestionRequest
): boolean {
  return request.questions.every(
    (question) => selectedQuestionOptionIds(selections, request.id, question.id).length > 0
  );
}

export function useChatRequestResponses(source: ChatRequestResponsesSource) {
  const props = source;
  const toasts = useToastStore();

  const questionSelections = ref<QuestionSelections>({});

  watch(
    () => props.pendingQuestions.map((question) => question.id).join(','),
    () => {
      const next: QuestionSelections = {};
      for (const question of props.pendingQuestions) {
        next[question.id] = questionSelections.value[question.id] ?? {};
      }
      questionSelections.value = next;
    }
  );

  function selectedOptionIds(questionRequestId: string, questionId: string): string[] {
    return selectedQuestionOptionIds(questionSelections.value, questionRequestId, questionId);
  }

  function toggleQuestionOption(
    request: ChatQuestionRequest,
    questionId: string,
    optionId: string,
    allowMultiple: boolean
  ): void {
    const current = selectedOptionIds(request.id, questionId);
    let next: string[];
    if (allowMultiple) {
      next = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
    } else {
      next = current.includes(optionId) && current.length === 1 ? [] : [optionId];
    }
    questionSelections.value = {
      ...questionSelections.value,
      [request.id]: {
        ...(questionSelections.value[request.id] ?? {}),
        [questionId]: next
      }
    };
  }

  function submitQuestion(request: ChatQuestionRequest): void {
    if (!canSubmitQuestionRequest(questionSelections.value, request)) return;
    const answers: ChatQuestionAnswer[] = request.questions.map((question) => ({
      questionId: question.id,
      selectedOptionIds: selectedOptionIds(request.id, question.id)
    }));
    respondOnce(request.id, () => props.sendQuestionResponse(request.id, { answers }));
  }

  function skipQuestion(request: ChatQuestionRequest): void {
    respondOnce(request.id, () => props.sendQuestionResponse(request.id, { skipped: true }));
  }

  function respondToApproval(approval: ChatApprovalRequest, optionId: string): void {
    respondOnce(approval.id, () => props.sendApprovalResponse(approval.id, optionId));
  }

  /** Approval / question request ids whose answer was sent but not yet resolved by the server. */
  const pendingResponseIds = ref<Set<string>>(new Set());

  function respondOnce(requestId: string, send: () => boolean): void {
    if (pendingResponseIds.value.has(requestId)) return;
    if (!send()) {
      toasts.error('Not connected to the session');
      return;
    }
    pendingResponseIds.value = new Set([...pendingResponseIds.value, requestId]);
  }

  // approval-resolved / question-resolved drop the request from the props → prune its pending mark.
  watch(
    () => [
      ...props.pendingApprovals.map((approval) => approval.id),
      ...props.pendingQuestions.map((question) => question.id)
    ],
    (ids) => {
      if (pendingResponseIds.value.size === 0) return;
      const live = new Set(ids);
      const next = new Set([...pendingResponseIds.value].filter((id) => live.has(id)));
      if (next.size !== pendingResponseIds.value.size) pendingResponseIds.value = next;
    }
  );

  return {
    questionSelections,
    pendingResponseIds,
    toggleQuestionOption,
    submitQuestion,
    skipQuestion,
    respondToApproval
  };
}
