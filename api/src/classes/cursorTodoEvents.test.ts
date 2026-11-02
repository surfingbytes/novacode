// node_modules
import { describe, expect, it, vi } from 'vitest';

// classes
import { clearCursorTodoState, handleCursorUpdateTodos } from './cursorTodoEvents';

function update(sessionId: string, todos: { id: string; content: string }[], merge: boolean) {
  return handleCursorUpdateTodos({ toolCallId: 'tc', todos, merge }, () => sessionId, () => vi.fn());
}

describe('clearCursorTodoState', () => {
  it('drops the stored todos so the next merge starts empty', () => {
    update('acp-1', [{ id: 'a', content: 'A' }], false);
    expect(update('acp-1', [{ id: 'b', content: 'B' }], true).outcome).toMatchObject({
      todos: [{ id: 'a' }, { id: 'b' }]
    });

    clearCursorTodoState('acp-1');

    expect(update('acp-1', [{ id: 'c', content: 'C' }], true).outcome).toMatchObject({
      todos: [{ id: 'c' }]
    });
  });
});
