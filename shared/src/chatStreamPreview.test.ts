// node_modules
import { describe, it, expect } from 'vitest';

// classes
import { extractStreamNotificationPreview } from './chatStreamPreview.js';

// ---------------------------------- ACP native format ----------------------------------

describe('ACP native events', () => {
  it('appends incremental agent_message_chunk events verbatim', () => {
    const events = [
      JSON.stringify({
        sessionId: 's1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello ' }
        }
      }),
      JSON.stringify({
        sessionId: 's1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'world' }
        }
      })
    ];
    expect(extractStreamNotificationPreview(events)).toBe('Hello world');
  });

  it('does not dedup repeated boundary substrings across incremental chunks', () => {
    // Regression: a table separator row split across chunk boundaries must
    // survive intact — greedy overlap trimming used to eat the repeated run.
    const chunks = ['| A | B |\n', '|----------|', '----------|\n', '| a', '  ', '| b |'];
    const events = chunks.map((text) =>
      JSON.stringify({
        sessionId: 's1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text }
        }
      })
    );
    expect(extractStreamNotificationPreview(events)).toBe(
      '| A | B |\n|----------|----------|\n| a  | b |'
    );
  });

  it('falls back to the last tool summary when the run ends on a tool call', () => {
    const events = [
      JSON.stringify({
        sessionId: 's1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 't1',
          kind: 'edit',
          title: 'src/app.ts'
        }
      }),
      JSON.stringify({
        sessionId: 's1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 't1',
          status: 'completed'
        }
      })
    ];
    expect(extractStreamNotificationPreview(events)).toBe('Edit: src/app.ts');
  });

  it('summarizes a todowrite tool_call (rawInput.todos) with normalized statuses', () => {
    const events = [
      JSON.stringify({
        sessionId: 's1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 't1',
          kind: 'other',
          title: 'TodoWrite',
          rawInput: {
            todos: [
              { content: 'one', status: 'completed' },
              { content: 'two', status: 'in_progress' }
            ]
          }
        }
      }),
      JSON.stringify({
        sessionId: 's1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 't1',
          status: 'completed',
          rawOutput: {
            todos: [
              { content: 'one', status: 'completed' },
              { content: 'two', status: 'completed' }
            ]
          }
        }
      })
    ];
    expect(extractStreamNotificationPreview(events)).toBe('Todos: 2/2 completed');
  });

  it('summarizes vibe-style todos from a JSON-string rawInput/rawOutput', () => {
    const events = [
      JSON.stringify({
        sessionId: 's1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 't1',
          kind: 'other',
          title: '2 todos',
          rawInput: JSON.stringify({
            action: 'write',
            todos: [
              { id: 'a', content: 'one', status: 'completed' },
              { id: 'b', content: 'two', status: 'in_progress' }
            ]
          })
        }
      }),
      JSON.stringify({
        sessionId: 's1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 't1',
          status: 'completed',
          rawOutput: JSON.stringify({
            message: 'ok',
            total_count: 2,
            todos: [
              { id: 'a', content: 'one', status: 'completed' },
              { id: 'b', content: 'two', status: 'completed' }
            ]
          })
        }
      })
    ];
    expect(extractStreamNotificationPreview(events)).toBe('Todos: 2/2 completed');
  });

  it('summarizes plan entries', () => {
    const events = [
      JSON.stringify({
        sessionId: 's1',
        update: {
          sessionUpdate: 'plan',
          entries: [
            { content: 'a', status: 'completed' },
            { content: 'b', status: 'pending' }
          ]
        }
      })
    ];
    expect(extractStreamNotificationPreview(events)).toBe('Plan: 1/2 completed');
  });
});

// ---------------------------------- Legacy cursor-style format ----------------------------------

describe('legacy cursor-style events', () => {
  it('merges cumulative assistant text without duplication', () => {
    const events = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Task' }] }
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Task completed.' }] }
      })
    ];
    expect(extractStreamNotificationPreview(events)).toBe('Task completed.');
  });

  it('unwraps nested stream envelopes', () => {
    const inner = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'nested text' }] }
    });
    const events = [JSON.stringify({ type: 'stream', data: inner })];
    expect(extractStreamNotificationPreview(events)).toBe('nested text');
  });

  it('summarizes completed todos', () => {
    const events = [
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'c1',
        tool_call: {
          updateTodosToolCall: {
            args: {
              todos: [
                { id: '1', content: 'one', status: 'TODO_STATUS_COMPLETED' },
                { id: '2', content: 'two', status: 'TODO_STATUS_IN_PROGRESS' }
              ]
            }
          }
        }
      })
    ];
    expect(extractStreamNotificationPreview(events)).toBe('Todos: 1/2 completed');
  });

  it('renders glob results with file counts', () => {
    const events = [
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'c1',
        tool_call: {
          globToolCall: {
            args: { globPattern: '*.ts', targetDirectory: 'src' }
          }
        }
      }),
      JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'c1',
        tool_call: {
          globToolCall: {
            args: { globPattern: '*.ts', targetDirectory: 'src' },
            result: { success: { files: ['a.ts', 'b.ts'] } }
          }
        }
      })
    ];
    expect(extractStreamNotificationPreview(events)).toBe(
      'Glob: *.ts in src → 2 files: a.ts, b.ts'
    );
  });
});

// ---------------------------------- Vibe tool results ----------------------------------

describe('vibe tool results', () => {
  it('summarizes role: tool events', () => {
    const events = [
      JSON.stringify({
        role: 'tool',
        name: 'read_file',
        content: 'file contents here',
        tool_call_id: 'v1'
      })
    ];
    expect(extractStreamNotificationPreview(events)).toBe('Read: file contents here');
  });
});

// ---------------------------------- Robustness ----------------------------------

describe('robustness', () => {
  it('ignores non-JSON lines and thinking events', () => {
    const events = ['not json', JSON.stringify({ type: 'thinking', content: 'hmm' })];
    expect(extractStreamNotificationPreview(events)).toBe('');
  });
});
