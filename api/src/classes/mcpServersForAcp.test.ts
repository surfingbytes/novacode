import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { writeAgentMcpAutoloadFiles, writeMcpClients } from './config';
import {
  applyMcpAutoloadFromChecks,
  getMcpAutoloadStatus,
  mcpUnavailableNoticeText,
  partitionMcpClients,
  toAcpMcpServer
} from './mcpServersForAcp';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-acp-test-'));
  tempDirs.push(dir);
  return dir;
}

describe('toAcpMcpServer', () => {
  it('converts an HTTP entry', () => {
    expect(
      toAcpMcpServer('joplin', {
        type: 'http',
        url: 'http://joplin-mcp:3000/mcp',
        headers: { Authorization: 'Bearer x' }
      })
    ).toEqual({
      type: 'http',
      name: 'joplin',
      url: 'http://joplin-mcp:3000/mcp',
      headers: [{ name: 'Authorization', value: 'Bearer x' }]
    });
  });

  it('converts a stdio entry', () => {
    expect(
      toAcpMcpServer('files', {
        command: 'npx',
        args: ['-y', 'mcp-server'],
        env: { FOO: 'bar' }
      })
    ).toEqual({
      name: 'files',
      command: 'npx',
      args: ['-y', 'mcp-server'],
      env: [{ name: 'FOO', value: 'bar' }]
    });
  });

  it('returns null for an empty entry', () => {
    expect(toAcpMcpServer('broken', {})).toBeNull();
  });
});

describe('partitionMcpClients', () => {
  const clients = {
    joplin: { type: 'http', url: 'http://joplin-mcp:3000/mcp' },
    files: { command: 'npx', args: ['-y', 'files'] }
  };

  it('keeps only servers whose check succeeded', () => {
    const result = partitionMcpClients(clients, {
      joplin: { ok: false, kind: 'http', error: 'fetch failed' },
      files: { ok: true, kind: 'stdio', detail: 'Process started' }
    });
    expect(Object.keys(result.enabled)).toEqual(['files']);
    expect(result.enabled.files).toEqual(clients.files);
    expect(result.skipped).toEqual([{ name: 'joplin', error: 'fetch failed' }]);
  });

  it('skips every server when none are reachable', () => {
    const result = partitionMcpClients(clients, {
      joplin: { ok: false, kind: 'http', error: 'ECONNREFUSED' },
      files: { ok: false, kind: 'stdio', error: 'Process exited with code 1' }
    });
    expect(result.enabled).toEqual({});
    expect(result.skipped.map((s) => s.name)).toEqual(['joplin', 'files']);
  });
});

describe('mcpUnavailableNoticeText', () => {
  it('names a single skipped server', () => {
    expect(mcpUnavailableNoticeText([{ name: 'joplin', error: 'down' }])).toContain('joplin');
  });

  it('is empty when nothing was skipped', () => {
    expect(mcpUnavailableNoticeText([])).toBe('');
  });
});

describe('writeMcpClients', () => {
  it('persists canonical config and clears agent autoload until a probe', () => {
    const configDir = tempConfigDir();
    mkdirSync(join(configDir, '.cursor'), { recursive: true });
    writeFileSync(
      join(configDir, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { stale: { url: 'http://down:1' } } }),
      'utf8'
    );

    writeMcpClients(configDir, {
      joplin: { type: 'http', url: 'http://joplin-mcp:3000/mcp' }
    });

    const canonical = JSON.parse(readFileSync(join(configDir, 'mcp-clients.json'), 'utf8')) as {
      joplin: { url: string };
    };
    expect(canonical.joplin.url).toBe('http://joplin-mcp:3000/mcp');

    const cursorMcp = JSON.parse(readFileSync(join(configDir, '.cursor', 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(cursorMcp.mcpServers).toEqual({});
  });
});

describe('applyMcpAutoloadFromChecks', () => {
  it('writes only reachable servers to agent autoload files', () => {
    const configDir = tempConfigDir();
    const clients = {
      joplin: { type: 'http', url: 'http://joplin-mcp:3000/mcp' },
      down: { type: 'http', url: 'http://127.0.0.1:1/mcp' }
    };

    const status = applyMcpAutoloadFromChecks(configDir, clients, {
      joplin: { ok: true, kind: 'http', detail: 'HTTP 200' },
      down: { ok: false, kind: 'http', error: 'ECONNREFUSED' }
    });

    expect(status.status).toBe('ready');
    expect(status.enabled).toEqual(['joplin']);
    expect(status.skipped).toEqual([{ name: 'down', error: 'ECONNREFUSED' }]);
    expect(getMcpAutoloadStatus().enabled).toEqual(['joplin']);

    const cursorMcp = JSON.parse(readFileSync(join(configDir, '.cursor', 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { url?: string }>;
    };
    expect(cursorMcp.mcpServers.joplin?.url).toBe('http://joplin-mcp:3000/mcp');
    expect(cursorMcp.mcpServers.down).toBeUndefined();
  });
});

describe('writeAgentMcpAutoloadFiles', () => {
  it('writes http type for URL-only servers', () => {
    const configDir = tempConfigDir();
    writeAgentMcpAutoloadFiles(configDir, {
      joplin: { url: 'http://joplin-mcp:3000/mcp' }
    });
    const cursorMcp = JSON.parse(readFileSync(join(configDir, '.cursor', 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { type?: string }>;
    };
    expect(cursorMcp.mcpServers.joplin?.type).toBe('http');
  });
});
