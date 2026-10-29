<script setup lang="ts">
/**
 * ACP approval request cards and Cursor ask_question prompts in the live turn.
 * Extracted from ChatMessageList.vue; response state lives in useChatRequestResponses.
 */

// composables
import {
  canSubmitQuestionRequest,
  selectedQuestionOptionIds,
  type QuestionSelections
} from '@/composables/useChatRequestResponses';

// utils
import { renderMdCached } from '@/utils/chatDisplayItems';

// types
import type { ChatApprovalRequest, ChatQuestionRequest } from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  pendingApprovals: ChatApprovalRequest[];
  pendingQuestions: ChatQuestionRequest[];
  questionSelections: QuestionSelections;
  /** Request ids whose answer was sent but not yet resolved by the server */
  pendingResponseIds: Set<string>;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'respondApproval', approval: ChatApprovalRequest, optionId: string): void;
  (
    e: 'toggleQuestionOption',
    request: ChatQuestionRequest,
    questionId: string,
    optionId: string,
    allowMultiple: boolean
  ): void;
  (e: 'submitQuestion', request: ChatQuestionRequest): void;
  (e: 'skipQuestion', request: ChatQuestionRequest): void;
}>();

// -------------------------------------------------- Helpers --------------------------------------------------

function approvalOptionClass(kind: string): string {
  if (kind.startsWith('reject')) {
    return 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15';
  }
  if (kind === 'allow_always') {
    return 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15';
  }
  return 'border-fg/15 bg-fg/[0.04] text-text-primary hover:bg-fg/[0.08]';
}

function approvalSubtitle(approval: ChatApprovalRequest): string {
  if (approval.planMarkdown) return 'Review the plan, then choose how to proceed';
  if (approval.toolName && approval.toolKind) return `${approval.toolName} · ${approval.toolKind}`;
  return approval.toolName ?? approval.toolKind ?? 'Tool permission';
}

function approvalPlanHtml(approval: ChatApprovalRequest): string {
  return renderMdCached(approval.planMarkdown);
}

function isOptionSelected(questionRequestId: string, questionId: string, optionId: string): boolean {
  return selectedQuestionOptionIds(props.questionSelections, questionRequestId, questionId).includes(
    optionId
  );
}

function canSubmitQuestion(request: ChatQuestionRequest): boolean {
  return canSubmitQuestionRequest(props.questionSelections, request);
}

function isResponsePending(requestId: string): boolean {
  return props.pendingResponseIds.has(requestId);
}
</script>

<template>
  <!-- ACP approval requests -->
  <div
    v-for="approval in pendingApprovals"
    :key="approval.id"
    class="flex justify-start"
  >
    <div class="chat-card max-w-full md:max-w-[85%] w-[34rem] rounded-lg px-3 py-3 text-sm">
      <div class="flex items-start gap-2">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="mt-0.5 shrink-0 text-warning"
          aria-hidden="true"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
        </svg>
        <div class="min-w-0 flex-1">
          <div class="font-medium text-text-primary">{{ approval.title }}</div>
          <div class="mt-0.5 text-xs text-text-muted">{{ approvalSubtitle(approval) }}</div>
          <div
            v-if="approval.planMarkdown"
            class="chat-markdown plan-markdown mt-3 max-h-[min(28rem,50vh)] overflow-y-auto rounded border border-fg/10 bg-fg/[0.03] px-3 py-2.5 text-sm text-text-primary"
            v-html="approvalPlanHtml(approval)"
          />
          <pre
            v-else-if="approval.command"
            class="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded bg-fg/[0.04] px-2 py-1.5 font-mono text-[11px] text-text-muted"
            >{{ approval.command }}</pre
          >
          <div v-if="approval.cwd && !approval.planMarkdown" class="mt-1 truncate font-mono text-[11px] text-text-muted/70">
            cwd: {{ approval.cwd }}
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              v-for="option in approval.options"
              :key="option.optionId"
              type="button"
              class="rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              :class="approvalOptionClass(option.kind)"
              :disabled="isResponsePending(approval.id)"
              @click="emit('respondApproval', approval, option.optionId)"
            >
              {{ option.name }}
            </button>
            <div
              v-if="isResponsePending(approval.id)"
              class="self-center w-4 h-4 border-2 border-surface border-t-primary rounded-full animate-spin"
              aria-label="Sending"
            ></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Cursor ACP ask_question prompts -->
  <div
    v-for="questionRequest in pendingQuestions"
    :key="questionRequest.id"
    class="flex justify-start"
  >
    <div class="chat-card max-w-full md:max-w-[85%] w-[34rem] rounded-lg px-3 py-3 text-sm">
      <div class="flex items-start gap-2">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="mt-0.5 shrink-0 text-primary"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
        <div class="min-w-0 flex-1">
          <div class="font-medium text-text-primary">
            {{ questionRequest.title || 'Agent needs input' }}
          </div>
          <div class="mt-0.5 text-xs text-text-muted">Answer to continue</div>
          <div class="mt-3 space-y-3">
            <div
              v-for="question in questionRequest.questions"
              :key="question.id"
              class="rounded-md bg-fg/[0.03] px-2.5 py-2"
            >
              <div class="text-sm text-text-primary">{{ question.prompt }}</div>
              <div
                v-if="question.allowMultiple"
                class="mt-1 text-[11px] text-text-muted/70"
              >
                Select one or more
              </div>
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  v-for="option in question.options"
                  :key="option.id"
                  type="button"
                  class="rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  :class="
                    isOptionSelected(questionRequest.id, question.id, option.id)
                      ? 'border-primary/30 bg-primary/15 text-primary'
                      : 'border-fg/15 bg-fg/[0.04] text-text-primary hover:bg-fg/[0.08]'
                  "
                  :disabled="isResponsePending(questionRequest.id)"
                  @click="
                    emit(
                      'toggleQuestionOption',
                      questionRequest,
                      question.id,
                      option.id,
                      question.allowMultiple === true
                    )
                  "
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-md border border-primary/30 bg-primary/15 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="!canSubmitQuestion(questionRequest) || isResponsePending(questionRequest.id)"
              @click="emit('submitQuestion', questionRequest)"
            >
              Submit
            </button>
            <button
              type="button"
              class="rounded-md border border-fg/15 bg-fg/[0.04] px-2.5 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-fg/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="isResponsePending(questionRequest.id)"
              @click="emit('skipQuestion', questionRequest)"
            >
              Skip
            </button>
            <div
              v-if="isResponsePending(questionRequest.id)"
              class="self-center w-4 h-4 border-2 border-surface border-t-primary rounded-full animate-spin"
              aria-label="Sending"
            ></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-card {
  background: var(--bg-elev-2);
  border: 1px solid var(--line);
}
</style>
