// node_modules
import { describe, it, expect } from 'vitest';

// classes
import { buildPromptContent } from './acpSubprocessRunner';

describe('buildPromptContent', () => {
  it('returns a single text block when there are no attachments', () => {
    expect(buildPromptContent('hello')).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('appends one image block per attachment, after the text block', () => {
    const content = buildPromptContent('look at this', [
      { mimeType: 'image/png', data: 'aGVsbG8=', path: '/tmp/uploads/pic one.png' },
      { mimeType: 'image/jpeg', data: 'd29ybGQ=', path: '/tmp/uploads/photo.jpg' },
    ]);

    expect(content).toHaveLength(3);
    expect(content[0]).toEqual({ type: 'text', text: 'look at this' });
    expect(content[1]).toEqual({
      type: 'image',
      data: 'aGVsbG8=',
      mimeType: 'image/png',
      uri: 'file:///tmp/uploads/pic%20one.png',
    });
    expect(content[2]).toEqual({
      type: 'image',
      data: 'd29ybGQ=',
      mimeType: 'image/jpeg',
      uri: 'file:///tmp/uploads/photo.jpg',
    });
  });
});
