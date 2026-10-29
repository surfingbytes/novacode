// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { sessionsApi } from '@/classes/api';

describe('image URLs', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('never carry a token in the query string (the httpOnly cookie authenticates)', () => {
    localStorage.setItem('token', 'legacy-jwt');
    expect(sessionsApi.imageUrl('s1', 'a b.png')).toMatch(/\/sessions\/s1\/images\/a%20b\.png$/);
    expect(sessionsApi.toolImageUrl('/w/a.png')).toMatch(/\/files\/tool-image\?path=%2Fw%2Fa\.png$/);
    expect(sessionsApi.imageUrl('s1', 'a.png')).not.toContain('token');
    expect(sessionsApi.toolImageUrl('/w/a.png')).not.toContain('token');
  });
});
