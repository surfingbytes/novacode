// @vitest-environment jsdom
// node_modules
import { describe, it, expect } from 'vitest';

// utils
import {
  entriesFromPlanMarkdown,
  markPlanEntryDoneInMarkdown,
  planEntryLabels,
  planEntryParentIndexes,
  renderPlanMarkdownWithActions
} from '@/utils/planDocuments';

// ---------------------------------- Plan markdown entries ----------------------------------

describe('entriesFromPlanMarkdown', () => {
  it('prefers numbered entries, falls back to tasks/headings', () => {
    const md = '# Goal\n\n1. First step\n2. Second step\n\n## Notes\nsome text';
    const entries = entriesFromPlanMarkdown(md);
    expect(entries.map((e) => e.content)).toEqual(['First step', 'Second step']);
  });

  it('reads task-list entries', () => {
    const md = '- [ ] Do the thing\n- [x] Done thing';
    const entries = entriesFromPlanMarkdown(md);
    expect(entries).toHaveLength(2);
  });

  it('marks entries ending with " - done" as completed', () => {
    const md = '1. First step - done\n2. Second step';
    const entries = entriesFromPlanMarkdown(md);
    expect(entries[0]).toMatchObject({ content: 'First step - done', status: 'completed' });
    expect(entries[1]).toMatchObject({ content: 'Second step', status: 'pending' });
  });
});

describe('markPlanEntryDoneInMarkdown', () => {
  it('appends " - done" to the target entry line', () => {
    const md = '# Goal\n\n1. First step\n2. Second step\n';
    expect(markPlanEntryDoneInMarkdown(md, 0)).toContain('1. First step - done');
    expect(markPlanEntryDoneInMarkdown(md, 1)).toContain('2. Second step - done');
    expect(markPlanEntryDoneInMarkdown('1. Already - done\n', 0)).toBeNull();
  });
});

describe('nested plan steps', () => {
  const md = [
    '## 5. Rename mechanism - done',
    '',
    '1. Dashboard card',
    '2. Landing card',
    '',
    '## 6. Next step',
    '',
    '1. Sub of six',
    '',
    '## Notes',
    '',
    'tail'
  ].join('\n');

  it('maps list substeps to their numbered heading', () => {
    expect(planEntryParentIndexes(md)).toEqual([-1, 0, 0, -1, 3]);
  });

  it('labels full steps and substeps hierarchically', () => {
    expect(planEntryLabels(md)).toEqual(['5', '5.1', '5.2', '6', '6.1']);
    expect(planEntryLabels('1. One\n2. Two\n3. Three')).toEqual(['1', '2', '3']);
  });

  it('renders substeps inside the parent step body so collapse hides them', () => {
    const html = renderPlanMarkdownWithActions(md, entriesFromPlanMarkdown(md));
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const done = doc.querySelector('.plan-step[data-plan-done="true"]')!;
    const body = done.querySelector(':scope > .plan-step-body')!;
    expect(body.textContent).toContain('Dashboard card');
    expect(body.textContent).toContain('Landing card');
    expect(body.textContent).not.toContain('Next step');
    expect(doc.body.textContent).toContain('tail');
    expect(done.parentElement?.closest('.plan-step')).toBeNull();
  });
});

describe('renderPlanMarkdownWithActions', () => {
  it('wraps step title/body and adds mark-as-done for pending entries', () => {
    const md = '1. First step\n\nDetails\n\n2. Second step - done\n';
    const entries = entriesFromPlanMarkdown(md);
    const html = renderPlanMarkdownWithActions(md, entries);
    expect(html).toContain('plan-step-title');
    expect(html).toContain('plan-step-body');
    expect(html).toContain('data-plan-done="false"');
    expect(html).toContain('data-plan-done="true"');
    expect(html).toContain('plan-mark-done');
    expect(html).toContain('Start session');
  });
});
