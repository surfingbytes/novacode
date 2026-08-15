import { describe, expect, it } from 'vitest';

import { parseStartupStatus, startupStepIndex } from './startupStatus';

describe('parseStartupStatus', () => {
  it('reads a valid status payload', () => {
    expect(
      parseStartupStatus(
        JSON.stringify({
          status: 'starting',
          step: 'database',
          detail: 'Applying database migrations…',
          progress: 70
        })
      )
    ).toEqual({
      status: 'starting',
      step: 'database',
      detail: 'Applying database migrations…',
      progress: 70
    });
  });

  it('falls back when the file is empty or invalid', () => {
    expect(parseStartupStatus('')).toMatchObject({
      status: 'starting',
      step: 'boot',
      progress: 0
    });
    expect(parseStartupStatus('not-json')).toMatchObject({
      status: 'starting',
      step: 'boot'
    });
  });

  it('clamps progress and fills missing fields', () => {
    expect(parseStartupStatus(JSON.stringify({ progress: 140, step: '' }))).toEqual({
      status: 'starting',
      step: 'boot',
      detail: 'Starting Nova Code…',
      progress: 100
    });
  });
});

describe('startupStepIndex', () => {
  it('orders known steps and treats unknown as boot', () => {
    expect(startupStepIndex('boot')).toBe(0);
    expect(startupStepIndex('database')).toBe(3);
    expect(startupStepIndex('api')).toBe(4);
    expect(startupStepIndex('nope')).toBe(0);
  });
});
