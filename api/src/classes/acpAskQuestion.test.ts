// node_modules
import { describe, it, expect } from 'vitest';

// classes
import { parseAskQuestionParams } from './acpAskQuestion';

describe('parseAskQuestionParams', () => {
  it('parses a valid request and trims the title', () => {
    expect(
      parseAskQuestionParams({
        toolCallId: 't1',
        title: ' Pick ',
        questions: [{ id: 'q1', prompt: 'Which?', options: [{ id: 'a', label: 'A' }] }],
      })
    ).toEqual({
      toolCallId: 't1',
      title: 'Pick',
      questions: [{ id: 'q1', prompt: 'Which?', options: [{ id: 'a', label: 'A' }], allowMultiple: false }],
    });
  });

  it('rejects questions without options', () => {
    expect(parseAskQuestionParams({ toolCallId: 't1', questions: [{ id: 'q1', prompt: 'Which?', options: [] }] })).toBeNull();
  });
});
