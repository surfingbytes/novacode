/**
 * Minimal mock ACP agent for acpSubprocessRunner tests — speaks ndjson JSON-RPC
 * over stdin/stdout. Spawned as a real child process by the runner under test.
 *
 * Behaviour is controlled via env vars (forwarded by the runner from process.env):
 *   MOCK_MODE = 'prompt-ok'          — session/prompt responds immediately (default)
 *             'hang-until-cancel'    — session/prompt responds only after session/cancel
 *             'ignore-cancel'        — session/prompt never responds (forces hard kill)
 *             'fail-load'            — session/load responds with a JSON-RPC error
 *   MOCK_LOG  — path; every incoming message is appended as one JSON line.
 */

import { appendFileSync } from 'node:fs';
import readline from 'node:readline';

const SESSION_ID = 'mock-acp-session-1';
const mode = process.env.MOCK_MODE ?? 'prompt-ok';
const logPath = process.env.MOCK_LOG;

function log(msg) {
  if (logPath) {
    try {
      appendFileSync(logPath, JSON.stringify(msg) + '\n');
    } catch {
      // ignore logging errors
    }
  }
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

let pendingPromptId = null;

function settlePrompt(stopReason) {
  if (pendingPromptId !== null) {
    send({ jsonrpc: '2.0', id: pendingPromptId, result: { stopReason } });
    pendingPromptId = null;
  }
}

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  log(msg);

  const isNotification = msg.id === undefined && typeof msg.method === 'string';
  const isRequest = msg.id !== undefined && typeof msg.method === 'string';

  if (isNotification) {
    if (msg.method === 'session/cancel' && mode !== 'ignore-cancel') {
      settlePrompt('cancelled');
    }
    return;
  }
  if (!isRequest) return;

  switch (msg.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { protocolVersion: 1, agentCapabilities: {} },
      });
      break;
    case 'session/new':
      send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: SESSION_ID } });
      break;
    case 'session/load':
      if (mode === 'fail-load') {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32000, message: 'session not found' },
        });
      } else {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: { sessionId: msg.params?.sessionId ?? SESSION_ID },
        });
      }
      break;
    case 'session/prompt':
      if (mode === 'hang-until-cancel' || mode === 'ignore-cancel') {
        pendingPromptId = msg.id;
      } else {
        send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } });
      }
      break;
    default:
      // Keep unknown requests (config application etc.) unblocked.
      send({ jsonrpc: '2.0', id: msg.id, result: {} });
  }
});
