/**
 * Cursor ACP cursor/ask_question request types and parsing.
 */

/** Cursor ACP cursor/ask_question request params. */
export interface AcpAskQuestionParams {
  toolCallId: string;
  title?: string;
  questions: Array<{
    id: string;
    prompt: string;
    options: Array<{ id: string; label: string }>;
    allowMultiple?: boolean;
  }>;
}

/** Cursor ACP cursor/ask_question response. */
export interface AcpAskQuestionResponse {
  outcome:
    | {
        outcome: 'answered';
        answers: Array<{
          questionId: string;
          selectedOptionIds: string[];
        }>;
      }
    | { outcome: 'skipped'; reason?: string }
    | { outcome: 'cancelled' };
}

export type AcpAskQuestionHandler = (
  params: AcpAskQuestionParams
) => AcpAskQuestionResponse | Promise<AcpAskQuestionResponse>;

export function parseAskQuestionParams(params: unknown): AcpAskQuestionParams | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  const obj = params as Record<string, unknown>;
  if (typeof obj.toolCallId !== 'string' || !obj.toolCallId.trim()) return null;
  if (!Array.isArray(obj.questions) || obj.questions.length === 0) return null;

  const questions: AcpAskQuestionParams['questions'] = [];
  for (const raw of obj.questions) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const q = raw as Record<string, unknown>;
    if (typeof q.id !== 'string' || !q.id.trim()) return null;
    if (typeof q.prompt !== 'string' || !q.prompt.trim()) return null;
    if (!Array.isArray(q.options) || q.options.length === 0) return null;
    const options: Array<{ id: string; label: string }> = [];
    for (const rawOpt of q.options) {
      if (!rawOpt || typeof rawOpt !== 'object' || Array.isArray(rawOpt)) return null;
      const opt = rawOpt as Record<string, unknown>;
      if (typeof opt.id !== 'string' || !opt.id.trim()) return null;
      if (typeof opt.label !== 'string' || !opt.label.trim()) return null;
      options.push({ id: opt.id, label: opt.label });
    }
    questions.push({
      id: q.id,
      prompt: q.prompt,
      options,
      allowMultiple: q.allowMultiple === true,
    });
  }

  return {
    toolCallId: obj.toolCallId,
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : undefined,
    questions,
  };
}

export async function defaultAskQuestionResponse(): Promise<AcpAskQuestionResponse> {
  return {
    outcome: {
      outcome: 'skipped',
      reason: 'Nova Code does not support interactive questions yet.',
    },
  };
}
