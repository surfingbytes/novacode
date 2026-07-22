// node_modules
import { describe, it, expect, vi } from 'vitest';

// utils
import {
  createChatStreamParser,
  parseHistoryEventsCached,
  notificationPreviewFromStreamingItems,
  mergeStreamingTextChunks,
  prepareDisplayItem,
  entriesFromPlanMarkdown,
  shouldSkipDuplicateVibeEventLine,
  indexSeenVibeIdsFromEvents,
  type DisplayItem
} from '@/utils/chatDisplayItems';

// ---------------------------------- ACP native ----------------------------------

describe('ACP native events', () => {
  it('appends incremental agent_message_chunk text verbatim', () => {
    const parser = createChatStreamParser();
    const items: DisplayItem[] = [];
    parser.processEventLine(
      JSON.stringify({
        sessionId: 's1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } }
      }),
      items
    );
    parser.processEventLine(
      JSON.stringify({
        sessionId: 's1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world' } }
      }),
      items
    );
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('Hello world');
  });

  it('does not dedup repeated boundary substrings across incremental chunks', () => {
    // Regression: a table separator row split across chunk boundaries must
    // survive intact — greedy overlap trimming used to eat the repeated run.
    const parser = createChatStreamParser();
    const items: DisplayItem[] = [];
    const chunks = ['| A | B |\n', '|----------|', '----------|\n', '| a', '  ', '| b |'];
    for (const text of chunks) {
      parser.processEventLine(
        JSON.stringify({
          sessionId: 's1',
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }
        }),
        items
      );
    }
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('| A | B |\n|----------|----------|\n| a  | b |');
  });

  it('tracks tool_call lifecycle with locations and output', () => {
    const parser = createChatStreamParser();
    const items: DisplayItem[] = [];
    parser.processEventLine(
      JSON.stringify({
        sessionId: 's1',
        update: { sessionUpdate: 'tool_call', toolCallId: 't1', kind: 'edit', title: 'src/app.ts' }
      }),
      items
    );
    parser.processEventLine(
      JSON.stringify({
        sessionId: 's1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 't1',
          status: 'completed',
          locations: [{ path: 'src/app.ts', line: 3 }],
          content: [{ type: 'content', content: { type: 'text', text: 'ok' } }]
        }
      }),
      items
    );
    expect(items[0].kind).toBe('tool');
    expect(items[0].status).toBe('success');
    expect(items[0].locations?.[0]?.path).toBe('src/app.ts');
    expect(items[0].toolOutput).toBe('ok');
  });

  it('updates plan entries in place', () => {
    const parser = createChatStreamParser();
    const items: DisplayItem[] = [];
    const plan = (status: string) =>
      JSON.stringify({
        sessionId: 's1',
        update: { sessionUpdate: 'plan', entries: [{ content: 'step', status }], title: 'My plan' }
      });
    parser.processEventLine(plan('pending'), items);
    parser.processEventLine(plan('completed'), items);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('plan');
    expect(items[0].planTitle).toBe('My plan');
    expect(items[0].planEntries?.[0]?.status).toBe('completed');
  });

  it('forwards mode/model/config sync to hooks', () => {
    const onModeUpdate = vi.fn();
    const onModelUpdate = vi.fn();
    const onConfigUpdate = vi.fn();
    const parser = createChatStreamParser({ onModeUpdate, onModelUpdate, onConfigUpdate });
    const items: DisplayItem[] = [];
    parser.processEventLine(
      JSON.stringify({
        sessionId: 's1',
        update: { sessionUpdate: 'current_mode_update', currentModeId: 'agent' }
      }),
      items
    );
    parser.processEventLine(
      JSON.stringify({
        sessionId: 's1',
        update: {
          sessionUpdate: 'config_option_update',
          configOptions: [
            { id: 'model', category: 'model', type: 'select', currentValue: 'gpt-5' },
            { id: 'fast', category: 'fast', type: 'select', currentValue: 'true' }
          ]
        }
      }),
      items
    );
    expect(onModeUpdate).toHaveBeenCalledWith('agent');
    expect(onModelUpdate).toHaveBeenCalledWith('gpt-5');
    expect(onConfigUpdate).toHaveBeenCalledWith({ fast: 'true' });
  });

  it('does not forward config sync when applyConfigSync is false', () => {
    const onModeUpdate = vi.fn();
    const parser = createChatStreamParser({ onModeUpdate });
    parser.processEventLine(
      JSON.stringify({
        sessionId: 's1',
        update: { sessionUpdate: 'current_mode_update', currentModeId: 'agent' }
      }),
      [],
      { applyConfigSync: false }
    );
    expect(onModeUpdate).not.toHaveBeenCalled();
  });

  it('writes usage to the usage hook during live streams', () => {
    const usage = { value: null as { used: number; size: number } | null };
    const parser = createChatStreamParser({ usage });
    parser.processEventLine(
      JSON.stringify({
        sessionId: 's1',
        update: { sessionUpdate: 'usage_update', used: 100, size: 1000 }
      }),
      [],
      { liveThinking: true }
    );
    expect(usage.value).toEqual({ used: 100, size: 1000, cost: undefined });
  });

  it('appends agent_thought_chunk to thinking text unless hidden', () => {
    const thinkingText = { value: '' };
    const parser = createChatStreamParser({ thinkingText, isThinkingHidden: () => false });
    parser.processEventLine(
      JSON.stringify({
        sessionId: 's1',
        update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } }
      }),
      [],
      { liveThinking: true }
    );
    expect(thinkingText.value).toBe('hmm');

    const hiddenParser = createChatStreamParser({ thinkingText, isThinkingHidden: () => true });
    hiddenParser.processEventLine(
      JSON.stringify({
        sessionId: 's1',
        update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'more' } }
      }),
      [],
      { liveThinking: true }
    );
    expect(thinkingText.value).toBe('hmm');
  });
});

// ---------------------------------- Legacy cursor-style ----------------------------------

describe('legacy cursor-style events', () => {
  it('creates and completes todos', () => {
    const parser = createChatStreamParser();
    const items: DisplayItem[] = [];
    parser.processEventLine(
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'c1',
        tool_call: {
          updateTodosToolCall: {
            args: { todos: [{ id: '1', content: 'one', status: 'TODO_STATUS_IN_PROGRESS' }] }
          }
        }
      }),
      items
    );
    expect(items[0].kind).toBe('todos');
    parser.processEventLine(
      JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'c1',
        tool_call: {
          updateTodosToolCall: {
            result: {
              success: { todos: [{ id: '1', content: 'one', status: 'TODO_STATUS_COMPLETED' }] }
            }
          }
        }
      }),
      items
    );
    expect(items[0].status).toBe('success');
    expect(items[0].todoItems?.[0]?.status).toBe('TODO_STATUS_COMPLETED');
  });

  it('handles vibe role: tool results', () => {
    const parser = createChatStreamParser();
    const items: DisplayItem[] = [];
    parser.processEventLine(
      JSON.stringify({ role: 'tool', name: 'read_file', content: 'file body', tool_call_id: 'v1' }),
      items
    );
    expect(items[0].kind).toBe('tool');
    expect(items[0].toolName).toBe('Read');
    expect(items[0].status).toBe('success');
  });

  it('unwraps nested stream envelopes', () => {
    const parser = createChatStreamParser();
    const items: DisplayItem[] = [];
    const inner = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'nested' }] }
    });
    parser.processEventLine(JSON.stringify({ type: 'stream', data: inner }), items);
    expect(items[0]?.text).toBe('nested');
  });
});

// ---------------------------------- Text merging ----------------------------------

describe('mergeStreamingTextChunks', () => {
  it('handles cumulative snapshots, deltas, and overlaps', () => {
    expect(mergeStreamingTextChunks('abc', 'abcd')).toBe('abcd');
    expect(mergeStreamingTextChunks('abcd', 'abc')).toBe('abcd');
    expect(mergeStreamingTextChunks('abc', 'abc')).toBe('abc');
    expect(mergeStreamingTextChunks('abc', 'cd')).toBe('abcd');
    expect(mergeStreamingTextChunks('', 'x')).toBe('x');
  });
});

// ---------------------------------- History cache ----------------------------------

describe('parseHistoryEventsCached', () => {
  it('returns the identical items array for repeated calls (no re-parse)', () => {
    const events = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })
    ];
    const first = parseHistoryEventsCached(events);
    const second = parseHistoryEventsCached(events);
    expect(second).toBe(first);
  });

  it('re-parses when the events array grows', () => {
    const events = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })
    ];
    const first = parseHistoryEventsCached(events);
    events.push(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'yo' }] } })
    );
    const reparsed = parseHistoryEventsCached(events);
    expect(reparsed).not.toBe(first);
    // consecutive assistant chunks merge into a single text item
    expect(reparsed).toHaveLength(1);
    expect(reparsed[0].text).toBe('hiyo');
  });
});

// ---------------------------------- prepareDisplayItem ----------------------------------

describe('prepareDisplayItem', () => {
  it('renders markdown for text items (cached)', () => {
    const prepared = prepareDisplayItem({ kind: 'text', text: '**bold**' });
    expect(prepared.renderedHtml).toContain('<strong>');
  });

  it('counts completed todos and plan entries', () => {
    const todos = prepareDisplayItem({
      kind: 'todos',
      todoItems: [
        { id: '1', content: 'a', status: 'TODO_STATUS_COMPLETED' },
        { id: '2', content: 'b', status: 'TODO_STATUS_IN_PROGRESS' }
      ]
    });
    expect(todos.todoDoneCount).toBe(1);

    const plan = prepareDisplayItem({
      kind: 'plan',
      planEntries: [
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'pending' }
      ]
    });
    expect(plan.planCompletedCount).toBe(1);
  });
});

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
});

// ---------------------------------- Vibe dedup ----------------------------------

describe('vibe dedup', () => {
  it('skips already-seen message and tool-call ids', () => {
    const seenMessages = new Set<string>();
    const seenToolCalls = new Set<string>();
    const line = JSON.stringify({ role: 'assistant', message_id: 'm1', content: 'hi' });
    expect(shouldSkipDuplicateVibeEventLine(line, seenMessages, seenToolCalls)).toBe(false);
    expect(shouldSkipDuplicateVibeEventLine(line, seenMessages, seenToolCalls)).toBe(true);
  });

  it('indexes ids from history events', () => {
    const seenMessages = new Set<string>();
    const seenToolCalls = new Set<string>();
    indexSeenVibeIdsFromEvents(
      [JSON.stringify({ role: 'tool', tool_call_id: 't1', content: 'x' })],
      seenMessages,
      seenToolCalls
    );
    expect(seenToolCalls.has('t1')).toBe(true);
  });
});

// ---------------------------------- Notification preview ----------------------------------

describe('notificationPreviewFromStreamingItems', () => {
  it('prefers the last text, falls back to tool/todos/plan', () => {
    expect(
      notificationPreviewFromStreamingItems([
        { kind: 'text', text: 'all done' },
        { kind: 'tool', toolName: 'Edit', toolSummary: 'a.ts', status: 'success' }
      ])
    ).toBe('Edit: a.ts');
    expect(
      notificationPreviewFromStreamingItems([
        { kind: 'todos', todoItems: [{ id: '1', content: 'a', status: 'TODO_STATUS_COMPLETED' }] }
      ])
    ).toBe('Todos: 1/1 completed');
    expect(notificationPreviewFromStreamingItems([{ kind: 'plan', planEntries: [] }])).toBe(
      'Plan ready'
    );
  });
});
