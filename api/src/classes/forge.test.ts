import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createForgeConnection,
  deleteForgeConnection,
  listForgeConnections,
  matchConnectionForRemote,
  normalizeForgeRepoInput,
  normalizeForgeUrl,
  normalizeRemoteHosts,
  parseGitRemote,
  resolveForgeRepo,
  updateForgeConnection
} from './forge';

import type { ForgeConnection } from './forge';
import type { ForgeProvider } from '@novacode/shared';

function conn(id: string, provider: ForgeProvider, url: string, remoteHosts: string[] = []): ForgeConnection {
  return { id, name: id, provider, url, token: 't', remoteHosts, version: null, source: 'file' };
}

const GITEA = conn('gitea', 'gitea', 'http://gitea:3000', ['gitea.example.com']);
const GITHUB = conn('gh', 'github', 'https://github.com');
const GITLAB = conn('gl', 'gitlab', 'https://gitlab.com');

describe('forge connection store', () => {
  let configDir: string;
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = ['FORGE_URL', 'FORGE_TOKEN', 'FORGE_PROVIDER', 'FORGE_NAME', 'FORGE_REMOTE_HOSTS'];

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'forge-'));
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('normalizes URLs pasted with API suffixes', () => {
    expect(normalizeForgeUrl(' https://git.example.com/api/v1/ ')).toBe('https://git.example.com');
    expect(normalizeForgeUrl('https://gitlab.example.com/api/v4')).toBe('https://gitlab.example.com');
    expect(() => normalizeForgeUrl('git.example.com')).toThrow();
  });

  it('migrates the legacy single-connection file', () => {
    writeFileSync(join(configDir, 'forge.json'), JSON.stringify({ url: 'http://gitea:3000', token: 'abc', provider: 'forgejo' }));
    expect(listForgeConnections(configDir)).toEqual([
      expect.objectContaining({ id: 'default', provider: 'forgejo', url: 'http://gitea:3000', token: 'abc', name: 'Forgejo (gitea)' })
    ]);
  });

  it('adds, updates (keeping the token) and deletes connections side by side', () => {
    const gh = createForgeConnection(configDir, { provider: 'github', url: 'https://github.com/', token: 'ghp' }, { ok: true, provider: 'github' });
    const gt = createForgeConnection(
      configDir,
      { provider: 'gitea', url: 'http://gitea:3000', token: 'tea', remoteHosts: ['git@gitea.example.com:2222'] },
      { ok: true, provider: 'forgejo', version: '11.0.1+gitea-1.22.0' }
    );
    expect(listForgeConnections(configDir).map((c) => [c.name, c.provider])).toEqual([
      ['GitHub', 'github'],
      ['Forgejo (gitea)', 'forgejo']
    ]);
    expect(gt.remoteHosts).toEqual(['gitea.example.com']);

    const updated = updateForgeConnection(configDir, gt.id, { provider: 'forgejo', url: 'http://gitea:3000', name: 'Home' }, { ok: true, provider: 'forgejo' });
    expect(updated).toMatchObject({ name: 'Home', token: 'tea', remoteHosts: ['gitea.example.com'] });
    expect(JSON.parse(readFileSync(join(configDir, 'forge.json'), 'utf8')).connections).toHaveLength(2);

    expect(deleteForgeConnection(configDir, gh.id)).toBe(true);
    expect(listForgeConnections(configDir).map((c) => c.id)).toEqual([gt.id]);
  });

  it('adds a read-only connection from env', () => {
    process.env['FORGE_URL'] = 'https://gitlab.example.com/';
    process.env['FORGE_TOKEN'] = 'env';
    process.env['FORGE_PROVIDER'] = 'gitlab';
    expect(listForgeConnections(configDir)).toEqual([
      expect.objectContaining({ id: 'env', provider: 'gitlab', url: 'https://gitlab.example.com', source: 'env' })
    ]);
  });
});

describe('remote matching', () => {
  it('parses scp-style, ssh and https remotes', () => {
    expect(parseGitRemote('git@gitea.example.com:tomas/lumezzo.git')).toEqual({ host: 'gitea.example.com', path: 'tomas/lumezzo' });
    expect(parseGitRemote('ssh://git@gitea.example.com:2222/tomas/lumezzo.git')).toEqual({ host: 'gitea.example.com', path: 'tomas/lumezzo' });
    expect(parseGitRemote('https://gitlab.com/g/sub/p.git')).toEqual({ host: 'gitlab.com', path: 'g/sub/p' });
    expect(parseGitRemote('not a remote')).toBeNull();
  });

  it('normalizes remote host aliases', () => {
    expect(normalizeRemoteHosts([' git@Gitea.example.com:2222 ', 'ssh://x.y/z', '', 'bad host'])).toEqual(['gitea.example.com', 'x.y']);
  });

  it('routes each workspace to its own host', () => {
    const all = [GITEA, GITHUB, GITLAB];
    expect(matchConnectionForRemote('git@github.com:o/r.git', all)).toMatchObject({ connection: GITHUB, repo: 'o/r' });
    expect(matchConnectionForRemote('https://gitlab.com/g/sub/p.git', all)).toMatchObject({ connection: GITLAB, repo: 'g/sub/p' });
    expect(matchConnectionForRemote('ssh://git@gitea.example.com:2222/tomas/x.git', all)).toMatchObject({ connection: GITEA, repo: 'tomas/x' });
  });

  it('falls back to the only self-hosted connection for unknown private hosts', () => {
    const giteaNoAlias = conn('g', 'gitea', 'http://gitea:3000');
    expect(matchConnectionForRemote('git@other.example.com:o/r.git', [giteaNoAlias, GITHUB])?.connection.id).toBe('g');
    expect(matchConnectionForRemote('git@other.example.com:o/r.git', [giteaNoAlias, conn('g2', 'gitlab', 'https://gl.example.com')])).toBeNull();
    // Public hosts never fall back to a self-hosted connection.
    expect(matchConnectionForRemote('git@github.com:o/r.git', [giteaNoAlias])).toBeNull();
  });

  it('applies workspace overrides on top of detection', () => {
    const connections = [GITEA, GITHUB];
    const base = { connections, remoteUrl: 'git@github.com:o/r.git', overrideApplies: true };
    expect(resolveForgeRepo({ ...base, forgeConnectionId: null, forgeRepo: null })).toMatchObject({ source: 'remote', repo: 'o/r' });
    // Mirror on Gitea: pin the connection, repo derived from the remote path.
    expect(resolveForgeRepo({ ...base, forgeConnectionId: 'gitea', forgeRepo: null })).toMatchObject({
      source: 'override',
      repo: 'o/r',
      connection: GITEA
    });
    expect(resolveForgeRepo({ ...base, forgeConnectionId: null, forgeRepo: 'x/y' })).toMatchObject({ connection: GITHUB, repo: 'x/y' });
    // Nested repos ignore the override.
    expect(resolveForgeRepo({ ...base, overrideApplies: false, forgeConnectionId: 'gitea', forgeRepo: 'x/y' })).toMatchObject({
      source: 'remote',
      connection: GITHUB
    });
  });

  it('normalizes the workspace repo field per provider', () => {
    expect(normalizeForgeRepoInput('  ')).toBeNull();
    expect(normalizeForgeRepoInput('tomas/x.git', 'gitea')).toBe('tomas/x');
    expect(normalizeForgeRepoInput('g/sub/p', 'gitlab')).toBe('g/sub/p');
    expect(normalizeForgeRepoInput('https://gitea.example.com/tomas/x', 'gitea')).toBe('tomas/x');
    expect(() => normalizeForgeRepoInput('just-a-name')).toThrow();
  });
});
