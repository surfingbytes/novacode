import { describe, expect, it } from 'vitest';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import {
  isPlanApprovalRequest,
  planMarkdownFromPermission,
  textFromAcpContent,
} from './planApproval';

function permission(partial: {
  name?: string;
  title?: string;
  plan?: string;
  contentText?: string;
  optionIds?: string[];
}): RequestPermissionRequest {
  const options = (partial.optionIds ?? ['exit-plan-default', 'reject']).map((optionId) => ({
    optionId,
    name: optionId,
    kind: optionId.startsWith('reject') ? ('reject_once' as const) : ('allow_once' as const),
  }));
  return {
    sessionId: 'acp-1',
    toolCall: {
      toolCallId: 'tc-1',
      name: partial.name,
      title: partial.title,
      kind: 'switch_mode',
      rawInput: partial.plan ? { plan: partial.plan } : {},
      content: partial.contentText
        ? [{ type: 'content', content: { type: 'text', text: partial.contentText } }]
        : undefined,
    },
    options,
  } as RequestPermissionRequest;
}

describe('planApproval', () => {
  it('detects ExitPlanMode by tool name', () => {
    expect(isPlanApprovalRequest(permission({ name: 'ExitPlanMode', plan: '# Plan\n' }))).toBe(
      true
    );
  });

  it('detects Approve Plan title and exit-plan option ids', () => {
    expect(
      isPlanApprovalRequest(
        permission({ title: 'Approve Plan', optionIds: ['exit-plan-accept-edits', 'reject'] })
      )
    ).toBe(true);
  });

  it('does not treat ordinary tool permissions as plan approvals', () => {
    expect(
      isPlanApprovalRequest(
        permission({ name: 'Bash', title: 'Run command', optionIds: ['allow_once', 'reject'] })
      )
    ).toBe(false);
  });

  it('prefers rawInput.plan over content text', () => {
    expect(
      planMarkdownFromPermission(
        permission({
          name: 'ExitPlanMode',
          plan: '# From input',
          contentText: '# From content',
        })
      )
    ).toBe('# From input');
  });

  it('falls back to toolCall content text', () => {
    expect(
      planMarkdownFromPermission(
        permission({ name: 'ExitPlanMode', contentText: '## Steps\n\n1. Do thing' })
      )
    ).toBe('## Steps\n\n1. Do thing');
  });

  it('flattens nested ACP content blocks', () => {
    expect(
      textFromAcpContent([
        { type: 'content', content: { type: 'text', text: 'Hello ' } },
        { type: 'text', text: 'world' },
      ])
    ).toBe('Hello world');
  });
});
