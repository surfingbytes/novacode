// node_modules
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@agentclientprotocol/sdk';

// classes
import { config } from './config';
import { db } from './database';
import { NOVA_MCP_SERVER_NAME } from '@novacode/shared';

/**
 * Nova's built-in MCP server ("nova"): lets a chat agent write its session spec
 * and the orchestrator plan itself. Served by this API at NOVA_MCP_PATH and
 * attached to every chat session unless turned off in Settings → MCP.
 */
export const NOVA_MCP_PATH = '/api/mcp/nova';

const SETTINGS_FILE = 'nova-mcp.json';
const TOKEN_CONTEXT = 'nova-mcp:';

// -------------------------------------------- Settings --------------------------------------------

export function isNovaMcpEnabled(configDir: string = config.configDir): boolean {
  const filePath = join(configDir, SETTINGS_FILE);
  if (!existsSync(filePath)) return true;
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8')) as { enabled?: unknown };
    return data.enabled !== false;
  } catch {
    return true;
  }
}

export function setNovaMcpEnabled(enabled: boolean, configDir: string = config.configDir): void {
  writeFileSync(join(configDir, SETTINGS_FILE), JSON.stringify({ enabled }, null, 2) + '\n', 'utf8');
}

// -------------------------------------------- Auth --------------------------------------------

function sign(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(TOKEN_CONTEXT + sessionId).digest('hex');
}

/** Bearer token that ties MCP calls to one Nova session: `<sessionId>.<hmac>`. */
export function createNovaMcpToken(sessionId: string, secret: string = config.jwtSecret ?? ''): string {
  return `${sessionId}.${sign(sessionId, secret)}`;
}

/** Session id from a valid `Authorization: Bearer` value, else null. */
export function verifyNovaMcpToken(
  authorization: string | undefined,
  secret: string = config.jwtSecret ?? ''
): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? '');
  if (!match || !secret) return null;
  const token = match[1].trim();
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const sessionId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(sessionId, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return sessionId;
}

// -------------------------------------------- ACP server entry --------------------------------------------

/**
 * Minimal stdio ↔ HTTP bridge for agents without HTTP MCP support (Mistral Vibe):
 * forwards each JSON-RPC line to the Nova endpoint and prints the JSON reply.
 */
const STDIO_BRIDGE_SOURCE = `
const url = process.env.NOVA_MCP_URL, token = process.env.NOVA_MCP_TOKEN;
let buf = '', chain = Promise.resolve();
async function forward(line) {
  let id = null;
  try { id = JSON.parse(line).id ?? null; } catch { return; }
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + token }, body: line });
    const text = await res.text();
    if (text.trim()) process.stdout.write(text.trim() + '\\n');
    else if (id !== null && !res.ok) throw new Error('HTTP ' + res.status);
  } catch (err) {
    if (id !== null) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: String(err && err.message || err) } }) + '\\n');
  }
}
process.stdin.on('data', (d) => {
  buf += d;
  const lines = buf.split('\\n');
  buf = lines.pop();
  for (const line of lines) if (line.trim()) chain = chain.then(() => forward(line));
});
process.stdin.on('end', () => chain.then(() => process.exit(0)));
`;

export function novaMcpUrl(): string {
  return `http://127.0.0.1:${config.port}${NOVA_MCP_PATH}`;
}

/**
 * ACP `mcpServers` entry for a Nova chat session, or null when the server is
 * turned off. `bHttp` = the agent advertised `mcpCapabilities.http`.
 */
export function novaMcpServerForSession(sessionId: string, bHttp: boolean): McpServer | null {
  if (!isNovaMcpEnabled() || !config.jwtSecret) return null;
  const token = createNovaMcpToken(sessionId);
  if (bHttp) {
    return {
      type: 'http',
      name: NOVA_MCP_SERVER_NAME,
      url: novaMcpUrl(),
      headers: [{ name: 'Authorization', value: `Bearer ${token}` }]
    };
  }
  return {
    name: NOVA_MCP_SERVER_NAME,
    command: process.execPath,
    args: ['-e', STDIO_BRIDGE_SOURCE],
    env: [
      { name: 'NOVA_MCP_URL', value: novaMcpUrl() },
      { name: 'NOVA_MCP_TOKEN', value: token }
    ]
  };
}

/** Nova entry for real chat sessions only (one-shot runs use throwaway ids that aren't in the DB). */
export async function novaMcpServerIfSession(novaSessionId: string, bHttp: boolean): Promise<McpServer | null> {
  if (!isNovaMcpEnabled()) return null;
  const session = await db.getSession(novaSessionId).catch(() => undefined);
  return session ? novaMcpServerForSession(session.id, bHttp) : null;
}

/** Whether an ACP `initialize` result advertises HTTP MCP servers. */
export function agentSupportsHttpMcp(initialized: unknown): boolean {
  const caps = (initialized as {
    agentCapabilities?: { mcpCapabilities?: { http?: unknown } | null } | null;
  } | null)?.agentCapabilities?.mcpCapabilities;
  return caps?.http === true;
}

// -------------------------------------------- JSON-RPC protocol --------------------------------------------

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface NovaMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface NovaMcpToolResult {
  text: string;
  bError?: boolean;
}

export type NovaMcpToolHandler = (
  sessionId: string,
  name: string,
  args: Record<string, unknown>
) => Promise<NovaMcpToolResult>;

/**
 * Handle one JSON-RPC message (stateless Streamable HTTP, JSON responses).
 * Returns null for notifications (HTTP 202, no body).
 */
export async function handleNovaMcpMessage(
  sessionId: string,
  message: JsonRpcRequest,
  tools: NovaMcpTool[],
  callTool: NovaMcpToolHandler
): Promise<Record<string, unknown> | null> {
  const id = message.id ?? null;
  const bNotification = message.id === undefined || message.id === null;
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, text: string) => ({ jsonrpc: '2.0', id, error: { code, message: text } });

  switch (message.method) {
    case 'initialize': {
      const requested = typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : '';
      return reply({
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: NOVA_MCP_SERVER_NAME, title: 'Nova Code', version: '1.0.0' },
        instructions:
          'Nova Code tools for this chat: write the chat spec and save the orchestrator plan the user runs from the Orchestrator tab. Use them when the user asks for a spec, a plan or an orchestrator. In an orchestrator step session, call step_needs_input before ending your turn with a question for the user.'
      });
    }
    case 'ping':
      return bNotification ? null : reply({});
    case 'tools/list':
      return reply({ tools });
    case 'tools/call': {
      const name = typeof message.params?.name === 'string' ? message.params.name : '';
      if (!tools.some((tool) => tool.name === name)) return fail(-32602, `Unknown tool: ${name}`);
      const rawArgs = message.params?.arguments;
      const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};
      try {
        const result = await callTool(sessionId, name, args);
        return reply({ content: [{ type: 'text', text: result.text }], isError: result.bError === true });
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        return reply({ content: [{ type: 'text', text }], isError: true });
      }
    }
    default:
      if (bNotification) return null;
      return fail(-32601, `Method not found: ${message.method ?? ''}`);
  }
}
