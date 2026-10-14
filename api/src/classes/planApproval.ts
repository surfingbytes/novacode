/**
 * Detect Claude ExitPlanMode (and similar) permission requests that present a
 * plan for user review — used to surface plan markdown in the Plan tab / UI.
 */
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringProp(obj: Record<string, unknown> | null, key: string): string {
  const value = obj?.[key];
  return typeof value === 'string' ? value : '';
}

/** Flatten ACP content blocks into plain text. */
export function textFromAcpContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    const obj = asRecord(item);
    if (!obj) continue;
    if (obj.type === 'text' && typeof obj.text === 'string') {
      parts.push(obj.text);
      continue;
    }
    if (obj.type === 'content') {
      const inner = asRecord(obj.content);
      if (inner?.type === 'text' && typeof inner.text === 'string') {
        parts.push(inner.text);
      }
    }
  }
  return parts.join('');
}

function planFromRawInput(rawInput: unknown): string {
  const obj = asRecord(rawInput);
  if (!obj) return '';
  return typeof obj.plan === 'string' ? obj.plan.trim() : '';
}

/** True when this permission request is "approve / exit plan mode". */
export function isPlanApprovalRequest(params: RequestPermissionRequest): boolean {
  const toolCall = asRecord(params.toolCall) ?? {};
  const name = stringProp(toolCall, 'name');
  if (name === 'ExitPlanMode') return true;

  const title = stringProp(asRecord(params), 'title') || stringProp(toolCall, 'title');
  if (title.trim() === 'Approve Plan') return true;

  if (planFromRawInput(toolCall.rawInput)) return true;

  return params.options.some(
    (option) => typeof option.optionId === 'string' && option.optionId.startsWith('exit-plan-')
  );
}

/** Extract plan markdown from an ACP permission request, if present. */
export function planMarkdownFromPermission(params: RequestPermissionRequest): string | undefined {
  const toolCall = asRecord(params.toolCall) ?? {};
  const fromInput = planFromRawInput(toolCall.rawInput);
  if (fromInput) return fromInput;
  const fromContent = textFromAcpContent(toolCall.content).trim();
  return fromContent || undefined;
}
