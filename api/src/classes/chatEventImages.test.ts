import { describe, expect, it } from 'vitest';

import { stripInlineImagesFromEventLine } from './chatEventImages';

const BIG = 'A'.repeat(10_000);

describe('stripInlineImagesFromEventLine', () => {
  it('removes base64 data from content and rawOutput image blocks', () => {
    const line = JSON.stringify({
      sessionId: 's',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        status: 'completed',
        rawOutput: [{ type: 'image', source: { type: 'base64', data: BIG, media_type: 'image/jpeg' } }],
        content: [{ type: 'content', content: { type: 'image', data: BIG, mimeType: 'image/jpeg' } }]
      }
    });
    const stripped = stripInlineImagesFromEventLine(line);
    expect(stripped.length).toBeLessThan(1000);
    const parsed = JSON.parse(stripped);
    expect(parsed.update.toolCallId).toBe('t1');
    expect(parsed.update.rawOutput[0]).toEqual({
      type: 'image',
      source: { type: 'base64', data: '', media_type: 'image/jpeg' },
      omitted: true
    });
    expect(parsed.update.content[0].content).toEqual({
      type: 'image',
      data: '',
      mimeType: 'image/jpeg',
      omitted: true
    });
  });

  it('removes base64 from the Claude Code tool response meta', () => {
    const line = JSON.stringify({
      update: {
        _meta: {
          claudeCode: {
            toolName: 'Read',
            toolResponse: { type: 'image', file: { base64: BIG, type: 'image/jpeg', originalSize: 1 } }
          }
        },
        toolCallId: 't1',
        sessionUpdate: 'tool_call_update'
      }
    });
    const parsed = JSON.parse(stripInlineImagesFromEventLine(line));
    expect(parsed.update._meta.claudeCode.toolResponse).toEqual({
      type: 'image',
      file: { base64: '', type: 'image/jpeg', originalSize: 1 },
      omitted: true
    });
  });

  it('returns the same line when there is no image', () => {
    const line = JSON.stringify({ update: { sessionUpdate: 'agent_message_chunk', text: BIG } });
    expect(stripInlineImagesFromEventLine(line)).toBe(line);
  });

  it('keeps small image data and non-JSON lines', () => {
    const small = JSON.stringify({ type: 'image', data: 'abc', pad: BIG });
    expect(stripInlineImagesFromEventLine(small)).toBe(small);
    const raw = `not json "image" ${BIG}`;
    expect(stripInlineImagesFromEventLine(raw)).toBe(raw);
  });
});
