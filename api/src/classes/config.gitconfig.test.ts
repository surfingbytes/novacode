import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { writeGlobalGitConfig } from './config';

describe('writeGlobalGitConfig', () => {
  let configDir: string;

  afterEach(() => {
    if (configDir) rmSync(configDir, { recursive: true, force: true });
  });

  it('preserves includeIf sections when updating user identity', () => {
    configDir = mkdtempSync(join(tmpdir(), 'novacode-gitconfig-'));
    writeFileSync(
      join(configDir, '.gitconfig'),
      `[safe]
	directory = *
[user]
	name = old
	email = old@example.com
[includeIf "gitdir:/opt/src/github/"]
	path = /config/.config/git/github.gitconfig
`,
      'utf8'
    );

    writeGlobalGitConfig(configDir, 'surfingbytes', 'tom@example.com');
    const content = readFileSync(join(configDir, '.gitconfig'), 'utf8');
    expect(content).toContain('name = surfingbytes');
    expect(content).toContain('email = tom@example.com');
    expect(content).toContain('[includeIf "gitdir:/opt/src/github/"]');
    expect(content).toContain('path = /config/.config/git/github.gitconfig');
    expect(content).toContain('directory = *');
  });
});
