import { beforeEach, describe, expect, it, vi } from 'vitest';

const setSessionUnread = vi.fn();
const broadcastSessionListUpsert = vi.fn();

vi.mock('./database', () => ({
  db: {
    setSessionUnread: (...args: unknown[]) => setSessionUnread(...args)
  }
}));

vi.mock('./sessionListBroadcast', () => ({
  broadcastSessionListUpsert: (...args: unknown[]) => broadcastSessionListUpsert(...args)
}));

import { markSessionFinishedUnread, markSessionRead } from './sessionUnread';

const sessionRow = {
  id: 's1',
  workspaceId: 'w1',
  unread: true
};

describe('sessionUnread', () => {
  beforeEach(() => {
    setSessionUnread.mockReset();
    broadcastSessionListUpsert.mockReset();
  });

  it('does not mark unread when a viewer is watching', async () => {
    await markSessionFinishedUnread('s1', true);
    expect(setSessionUnread).not.toHaveBeenCalled();
    expect(broadcastSessionListUpsert).not.toHaveBeenCalled();
  });

  it('marks unread and broadcasts when no viewer is watching', async () => {
    setSessionUnread.mockResolvedValue(sessionRow);
    await markSessionFinishedUnread('s1', false);
    expect(setSessionUnread).toHaveBeenCalledWith('s1', true);
    expect(broadcastSessionListUpsert).toHaveBeenCalledWith('w1', sessionRow);
  });

  it('marks read and broadcasts when the flag changes', async () => {
    setSessionUnread.mockResolvedValue({ ...sessionRow, unread: false });
    await markSessionRead('s1');
    expect(setSessionUnread).toHaveBeenCalledWith('s1', false);
    expect(broadcastSessionListUpsert).toHaveBeenCalled();
  });

  it('does not broadcast when unread was already the requested value', async () => {
    setSessionUnread.mockResolvedValue(undefined);
    await markSessionRead('s1');
    expect(broadcastSessionListUpsert).not.toHaveBeenCalled();
  });
});
