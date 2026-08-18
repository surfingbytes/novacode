/**
 * Minimal mock ACP agent for acpSubprocessRunner tests — speaks ndjson JSON-RPC
 * over stdin/stdout. Spawned as a real child process by the runner under test.
 *
 * Behaviour is controlled via env vars (forwarded by the runner from process.env):
 *   MOCK_MODE = 'prompt-ok'          — session/prompt responds immediately (default)
 *             'hang-until-cancel'    — session/prompt responds only after session/cancel
 *             'ignore-cancel'        — session/prompt never responds (forces hard kill)
 *             'fail-load'            — session/load responds with a JSON-RPC error
 *             'fail-new-if-mcp'      — session/new errors when mcpServers is non-empty
 *             'prompt-permission'    — session/prompt asks the client for tool permission first
 *             'prompt-ask-question'  — session/prompt asks via cursor/ask_question first
 *             'prompt-update-todos'  — session/prompt sends cursor/update_todos first
 *             'prompt-silent-hang'   — session/prompt never responds and emits no updates
 *             'prompt-subagent-session-updates' — hangs while emitting session/update on a child session id
 *             'prompt-cursor-task'   — hangs while emitting cursor/task notifications
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
let pendingPermissionRequestId = null;
let pendingAskQuestionRequestId = null;
let pendingUpdateTodosRequestId = null;
let activityTimer = null;

function clearActivityTimer() {
  if (activityTimer !== null) {
    clearInterval(activityTimer);
    activityTimer = null;
  }
}

function settlePrompt(stopReason) {
  clearActivityTimer();
  if (pendingPromptId !== null) {
    send({ jsonrpc: '2.0', id: pendingPromptId, result: { stopReason } });
    pendingPromptId = null;
  }
}

function startActivityInterval(emit, times = 8, intervalMs = 80) {
  let n = 0;
  const tick = () => {
    n += 1;
    emit(n);
    if (n >= times) {
      settlePrompt('end_turn');
    }
  };
  tick();
  if (pendingPromptId === null) return;
  activityTimer = setInterval(() => {
    if (pendingPromptId === null) return;
    tick();
  }, intervalMs);
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

  if (!isRequest && msg.id === pendingPermissionRequestId) {
    pendingPermissionRequestId = null;
    settlePrompt(msg.result?.outcome?.outcome === 'selected' ? 'end_turn' : 'rejected');
    return;
  }

  if (!isRequest && msg.id === pendingAskQuestionRequestId) {
    pendingAskQuestionRequestId = null;
    const outcome = msg.result?.outcome?.outcome;
    settlePrompt(outcome === 'answered' || outcome === 'skipped' ? 'end_turn' : 'cancelled');
    return;
  }

  if (!isRequest && msg.id === pendingUpdateTodosRequestId) {
    pendingUpdateTodosRequestId = null;
    settlePrompt(msg.result?.outcome?.outcome === 'accepted' ? 'end_turn' : 'rejected');
    return;
  }

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
      if (mode === 'fail-new-if-mcp' && Array.isArray(msg.params?.mcpServers) && msg.params.mcpServers.length > 0) {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32000, message: 'mcp failed' },
        });
      } else {
        send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: SESSION_ID } });
      }
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
      } else if (mode === 'prompt-permission') {
        pendingPromptId = msg.id;
        pendingPermissionRequestId = 'mock-permission-request-1';
        send({
          jsonrpc: '2.0',
          id: pendingPermissionRequestId,
          method: 'session/request_permission',
          params: {
            sessionId: msg.params?.sessionId ?? SESSION_ID,
            toolCall: {
              toolCallId: 'mock-tool-1',
              kind: 'execute',
              title: 'Run command',
              name: 'shell',
              rawInput: {
                command: 'npm',
                args: ['test'],
                cwd: process.cwd(),
              },
            },
            options: [
              { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
              { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
            ],
          },
        });
      } else if (mode === 'prompt-ask-question') {
        pendingPromptId = msg.id;
        pendingAskQuestionRequestId = 'mock-ask-question-request-1';
        send({
          jsonrpc: '2.0',
          id: pendingAskQuestionRequestId,
          method: 'cursor/ask_question',
          params: {
            toolCallId: 'mock-ask-1',
            title: 'Need input',
            questions: [
              {
                id: 'q1',
                prompt: 'Which mode should I use?',
                options: [
                  { id: 'agent', label: 'Agent' },
                  { id: 'plan', label: 'Plan' },
                ],
                allowMultiple: false,
              },
            ],
          },
        });
      } else if (mode === 'prompt-update-todos') {
        pendingPromptId = msg.id;
        pendingUpdateTodosRequestId = 'mock-update-todos-request-1';
        send({
          jsonrpc: '2.0',
          id: pendingUpdateTodosRequestId,
          method: 'cursor/update_todos',
          params: {
            toolCallId: 'mock-todos-1',
            merge: false,
            todos: [
              { id: '1', content: 'Set up project structure', status: 'completed' },
              { id: '2', content: 'Add authentication', status: 'in_progress' },
              { id: '3', content: 'Write unit tests', status: 'pending' },
            ],
          },
        });
      } else if (mode === 'prompt-silent-hang') {
        pendingPromptId = msg.id;
      } else if (mode === 'prompt-subagent-session-updates') {
        pendingPromptId = msg.id;
        startActivityInterval((n) => {
          send({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'mock-subagent-session',
              update: {
                sessionUpdate: 'agent_thought_chunk',
                content: { type: 'text', text: `subagent thinking ${n}` },
              },
            },
          });
        });
      } else if (mode === 'prompt-cursor-task') {
        pendingPromptId = msg.id;
        startActivityInterval((n) => {
          send({
            jsonrpc: '2.0',
            method: 'cursor/task',
            params: {
              toolCallId: 'mock-task-1',
              description: `Explore codebase ${n}`,
              prompt: 'Find where authentication is handled.',
              subagentType: 'explore',
            },
          });
        });
      } else {
        send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } });
      }
      break;
    default:
      // Keep unknown requests (config application etc.) unblocked.
      send({ jsonrpc: '2.0', id: msg.id, result: {} });
  }
});
