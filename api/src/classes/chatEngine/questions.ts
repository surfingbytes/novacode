// node_modules
import { randomUUID } from 'node:crypto';

// classes
import type { AcpAskQuestionParams, AcpAskQuestionResponse } from '../acpSubprocessRunner';
import { activeRuns } from './state';

// types
import type { ActiveRun, PendingQuestion } from './types';
import type { ChatQuestionAnswer, ChatQuestionRequest } from '../../@types/index';

function cancelledAskQuestionResponse(): AcpAskQuestionResponse {
  return { outcome: { outcome: 'cancelled' } };
}

function skippedAskQuestionResponse(reason?: string): AcpAskQuestionResponse {
  return { outcome: { outcome: 'skipped', reason } };
}

function questionRequestFromAcp(
  sessionId: string,
  params: AcpAskQuestionParams
): ChatQuestionRequest {
  return {
    id: randomUUID(),
    sessionId,
    toolCallId: params.toolCallId,
    title: params.title,
    questions: params.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      allowMultiple: question.allowMultiple === true,
      options: question.options.map((option) => ({
        id: option.id,
        label: option.label,
      })),
    })),
  };
}

function broadcastQuestionRequested(run: ActiveRun, question: ChatQuestionRequest): void {
  for (const sub of run.subscribers) {
    sub.onQuestionRequested?.(question);
  }
}

function broadcastQuestionResolved(run: ActiveRun, questionRequestId: string): void {
  for (const sub of run.subscribers) {
    sub.onQuestionResolved?.(questionRequestId);
  }
}

function resolvePendingQuestion(
  run: ActiveRun,
  pending: PendingQuestion,
  response: AcpAskQuestionResponse
): void {
  if (!run.pendingQuestions.delete(pending.question.id)) return;
  pending.resolve(response);
  broadcastQuestionResolved(run, pending.question.id);
}

export function cancelPendingQuestions(run: ActiveRun): void {
  for (const pending of [...run.pendingQuestions.values()]) {
    resolvePendingQuestion(run, pending, cancelledAskQuestionResponse());
  }
}

function validateQuestionAnswers(
  question: ChatQuestionRequest,
  answers: ChatQuestionAnswer[]
): ChatQuestionAnswer[] | null {
  if (!Array.isArray(answers) || answers.length === 0) return null;

  const byId = new Map(question.questions.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const normalized: ChatQuestionAnswer[] = [];

  for (const answer of answers) {
    if (!answer || typeof answer.questionId !== 'string') return null;
    if (seen.has(answer.questionId)) return null;
    const item = byId.get(answer.questionId);
    if (!item) return null;
    if (!Array.isArray(answer.selectedOptionIds) || answer.selectedOptionIds.length === 0) {
      return null;
    }
    if (!item.allowMultiple && answer.selectedOptionIds.length !== 1) return null;

    const optionIds = new Set(item.options.map((option) => option.id));
    const selected: string[] = [];
    const selectedSeen = new Set<string>();
    for (const optionId of answer.selectedOptionIds) {
      if (typeof optionId !== 'string' || !optionIds.has(optionId) || selectedSeen.has(optionId)) {
        return null;
      }
      selectedSeen.add(optionId);
      selected.push(optionId);
    }

    seen.add(answer.questionId);
    normalized.push({ questionId: answer.questionId, selectedOptionIds: selected });
  }

  // Require an answer for every question in the request.
  if (normalized.length !== question.questions.length) return null;
  return normalized;
}

export function requestAcpAskQuestionForSession(
  sessionId: string,
  params: AcpAskQuestionParams
): Promise<AcpAskQuestionResponse> {
  const run = activeRuns.get(sessionId);
  if (!run) {
    return Promise.resolve(cancelledAskQuestionResponse());
  }

  const question = questionRequestFromAcp(sessionId, params);
  return new Promise((resolve) => {
    const pending: PendingQuestion = { question, resolve };
    run.pendingQuestions.set(question.id, pending);
    broadcastQuestionRequested(run, question);
  });
}

export function respondToAcpAskQuestion(
  sessionId: string,
  questionRequestId: string,
  response:
    | { skipped: true; reason?: string }
    | { skipped?: false; answers: ChatQuestionAnswer[] }
): boolean {
  const run = activeRuns.get(sessionId);
  const pending = run?.pendingQuestions.get(questionRequestId);
  if (!run || !pending) return false;

  if (response.skipped) {
    resolvePendingQuestion(run, pending, skippedAskQuestionResponse(response.reason));
    return true;
  }

  const answers = validateQuestionAnswers(pending.question, response.answers);
  if (!answers) return false;

  resolvePendingQuestion(run, pending, {
    outcome: { outcome: 'answered', answers },
  });
  return true;
}
