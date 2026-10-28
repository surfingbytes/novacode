// node_modules
import { describe, it, expect } from 'vitest';

// classes
import { extractCursorPlanPayload, normalizeCursorPlanStatus } from './cursorPlanEvents';

describe('normalizeCursorPlanStatus', () => {
  it('maps Cursor todo statuses to plan entry statuses', () => {
    expect(normalizeCursorPlanStatus('TODO_STATUS_COMPLETED')).toBe('completed');
    expect(normalizeCursorPlanStatus('running')).toBe('in_progress');
    expect(normalizeCursorPlanStatus(undefined)).toBe('pending');
  });
});

describe('extractCursorPlanPayload', () => {
  it('reads title, markdown and entries from a nested plan object', () => {
    const payload = extractCursorPlanPayload({
      plan: { title: 'Refactor', markdown: '# Goal\n\n## Step 1', todos: [{ content: 'Split', status: 'done' }] },
    });
    expect(payload).toEqual({
      title: 'Refactor',
      markdown: '# Goal\n\n## Step 1',
      entries: [{ content: 'Split', status: 'completed' }],
    });
  });

  it('drops the single entry that duplicates the markdown', () => {
    expect(extractCursorPlanPayload({ content: 'Do it' })).toEqual({
      title: undefined,
      markdown: 'Do it',
      entries: [],
    });
  });
});
