import { describe, expect, it } from 'vitest';

import { config } from './config';
import { resolveToolImagePath } from './toolImagePath';

describe('resolveToolImagePath', () => {
  it('rejects relative paths and non-image extensions', async () => {
    expect(await resolveToolImagePath('data/a.jpg')).toMatchObject({ status: 400 });
    expect(await resolveToolImagePath(`${config.workspaceBrowseRoot}/a.txt`)).toMatchObject({ status: 400 });
  });

  it('rejects images outside the workspace roots', async () => {
    expect(await resolveToolImagePath('/etc/../tmp/a.png')).toMatchObject({ status: 403 });
  });

  it('returns 404 for a missing image inside the browse root', async () => {
    expect(await resolveToolImagePath(`${config.workspaceBrowseRoot}/nova-missing-${Date.now()}.png`)).toMatchObject({
      status: 404
    });
  });
});
