import { describe, expect, it } from 'vitest';

import {
  agentSupportsHttpMcp,
  createNovaMcpToken,
  handleNovaMcpMessage,
  verifyNovaMcpToken,
  type NovaMcpTool
} from './novaMcp';

const SECRET = 'test-secret';

describe('nova MCP tokens', () => {
  it('round-trips the session id', () => {
    const token = createNovaMcpToken('sess-1', SECRET);
    expect(verifyNovaMcpToken(`Bearer ${token}`, SECRET)).toBe('sess-1');
  });

  it('rejects tampered, foreign or malformed tokens', () => {
    const token = createNovaMcpToken('sess-1', SECRET);
    expect(verifyNovaMcpToken(`Bearer ${token.replace('sess-1', 'sess-2')}`, SECRET)).toBeNull();
    expect(verifyNovaMcpToken(`Bearer ${token}`, 'other-secret')).toBeNull();
    expect(verifyNovaMcpToken(token, SECRET)).toBeNull();
    expect(verifyNovaMcpToken(undefined, SECRET)).toBeNull();
    expect(verifyNovaMcpToken(`Bearer ${token}`, '')).toBeNull();
  });
});

describe('agentSupportsHttpMcp', () => {
  it('reads mcpCapabilities.http from the initialize result', () => {
    expect(agentSupportsHttpMcp({ agentCapabilities: { mcpCapabilities: { http: true } } })).toBe(true);
    expect(agentSupportsHttpMcp({ agentCapabilities: {} })).toBe(false);
    expect(agentSupportsHttpMcp(null)).toBe(false);
  });
});

describe('handleNovaMcpMessage', () => {
  const tools: NovaMcpTool[] = [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }];
  const callTool = async (sessionId: string, name: string, args: Record<string, unknown>) =>
    args.fail ? { text: 'bad input', bError: true } : { text: `${sessionId}:${name}:${String(args.value)}` };

  it('negotiates the protocol version on initialize', async () => {
    const known = await handleNovaMcpMessage('s', { id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, tools, callTool);
    expect(known).toMatchObject({ id: 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} } } });
    const unknown = await handleNovaMcpMessage('s', { id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, tools, callTool);
    expect(unknown).toMatchObject({ result: { protocolVersion: '2025-06-18' } });
  });

  it('lists and calls tools', async () => {
    expect(await handleNovaMcpMessage('s', { id: 1, method: 'tools/list' }, tools, callTool)).toMatchObject({
      result: { tools }
    });
    expect(
      await handleNovaMcpMessage('s', { id: 2, method: 'tools/call', params: { name: 'echo', arguments: { value: 7 } } }, tools, callTool)
    ).toMatchObject({ result: { content: [{ type: 'text', text: 's:echo:7' }], isError: false } });
    expect(
      await handleNovaMcpMessage('s', { id: 3, method: 'tools/call', params: { name: 'echo', arguments: { fail: true } } }, tools, callTool)
    ).toMatchObject({ result: { isError: true } });
    expect(
      await handleNovaMcpMessage('s', { id: 4, method: 'tools/call', params: { name: 'nope' } }, tools, callTool)
    ).toMatchObject({ error: { code: -32602 } });
  });

  it('returns nothing for notifications and errors for unknown requests', async () => {
    expect(await handleNovaMcpMessage('s', { method: 'notifications/initialized' }, tools, callTool)).toBeNull();
    expect(await handleNovaMcpMessage('s', { id: 9, method: 'resources/list' }, tools, callTool)).toMatchObject({
      error: { code: -32601 }
    });
  });
});
