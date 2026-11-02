import { execFileSync } from 'node:child_process';
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
    expect(content).toContain('name = "surfingbytes"');
    expect(content).toContain('email = "tom@example.com"');
    expect(content).toContain('[includeIf "gitdir:/opt/src/github/"]');
    expect(content).toContain('path = /config/.config/git/github.gitconfig');
    expect(content).toContain('directory = *');
  });

  it('escapes quotes, backslashes and newlines so values cannot break or inject config', () => {
    configDir = mkdtempSync(join(tmpdir(), 'novacode-gitconfig-'));
    const name = 'Tom "T" \\ O\'Neil ; # x';
    const email = 'a@b.c"\n[core]\n\tsshCommand = touch /tmp/pwned';

    writeGlobalGitConfig(configDir, name, email);
    const file = join(configDir, '.gitconfig');
    const read = (key: string): string =>
      execFileSync('git', ['config', '--file', file, '--get', key], { encoding: 'utf8' }).replace(/\n$/, '');

    expect(read('user.name')).toBe(name);
    expect(read('user.email')).toBe('a@b.c"\n[core]\n\tsshCommand = touch /tmp/pwned');
    expect(() => read('core.sshCommand')).toThrow();
    expect(readFileSync(file, 'utf8')).not.toMatch(/^\[core\]/m);
  });
});
