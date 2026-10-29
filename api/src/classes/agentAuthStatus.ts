// node_modules
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isOneShotAgentType, ONE_SHOT_AGENT_TYPES, resolveAutomaticOneShotAgentType } from '@novacode/shared';

// classes
import { execCli } from './childEnv';
import {
  config,
  getVibeApiKeyStatus,
  isClaudeAvailable,
  isCodexAcpAvailable,
  isVibeCliAvailable
} from './config';
import {
  cursorAuthErrorCheck,
  cursorAuthTimeoutCheck,
  isAuthRequiredError,
  isTimeoutError,
  type CursorAuthCheck
} from './agentError';
import { hasAnyOpenCodeAuth } from './openCodeProviders';

// types
import type { AgentType } from '../@types/index';

export const CURSOR_AUTH_FILE = '.config/cursor/auth.json';
// OpenCode stores provider credentials in its XDG data dir. `config.agentEnv()` sets
// XDG_DATA_HOME=/config/.local/share for spawned OpenCode processes.
export const OPENCODE_AUTH_FILE = '.local/share/opencode/auth.json';
export const OPENCODE_LEGACY_AUTH_FILE = '.opencode/auth.json';
export const CODEX_AUTH_FILE = '.codex/auth.json';

/** `cursor status` takes seconds — cache so status/capabilities stay cheap. */
const CURSOR_AUTH_TTL_MS = 30_000;
let cursorAuthCache: { result: CursorAuthCheck; at: number } | null = null;
let cursorAuthInFlight: Promise<CursorAuthCheck> | null = null;

export const clearCursorAuthCache = (): void => {
  cursorAuthCache = null;
};

export const checkCursorAuth = async (): Promise<CursorAuthCheck> => {
  const authPath = join(config.configDir, CURSOR_AUTH_FILE);

  if (existsSync(authPath)) {
    const authenticated: CursorAuthCheck = { authenticated: true, status: 'authenticated' };
    cursorAuthCache = { result: authenticated, at: Date.now() };
    return authenticated;
  }
  if (cursorAuthCache && Date.now() - cursorAuthCache.at < CURSOR_AUTH_TTL_MS) {
    return cursorAuthCache.result;
  }
  cursorAuthInFlight ??= probeCursorAuth().finally(() => {
    cursorAuthInFlight = null;
  });
  return cursorAuthInFlight;
};

const probeCursorAuth = async (): Promise<CursorAuthCheck> => {
  const result = await execCli(config.cursorCommand, ['status'], { timeoutMs: 5000 });
  const out = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const combinedError = [result.error, out].filter(Boolean).join('\n');

  let check: CursorAuthCheck;
  if (result.timedOut || (result.error && isTimeoutError(result.error))) {
    check = cursorAuthTimeoutCheck();
  } else if (isTimeoutError(combinedError)) {
    check = cursorAuthTimeoutCheck();
  } else if (isAuthRequiredError(out)) {
    check = {
      authenticated: false,
      status: 'unauthenticated',
      message: 'Cursor CLI is not authenticated. Log in to Cursor, then try again.'
    };
  } else if (result.error && result.status === null) {
    check = cursorAuthErrorCheck(result.error.message);
  } else if (result.status !== 0) {
    check = cursorAuthErrorCheck(out.trim() || `Cursor status exited with code ${result.status}`);
  } else if (out.trim() === '') {
    check = cursorAuthErrorCheck('Cursor status returned no output.');
  } else {
    check = { authenticated: true, status: 'authenticated' };
  }
  cursorAuthCache = { result: check, at: Date.now() };
  return check;
};

export const openCodeAuthenticated = (): boolean => {
  return hasAnyOpenCodeAuth(config.configDir);
};

export const codexAuthenticated = (): boolean => {
  const authPath = join(config.configDir, CODEX_AUTH_FILE);
  if (!existsSync(authPath)) return false;
  try {
    const data = JSON.parse(readFileSync(authPath, 'utf8'));
    const token = data?.oauth_token ?? data?.token ?? data?.access_token;
    return typeof token === 'string' && token.trim().length > 0;
  } catch {
    return false;
  }
};

/** Whether an agent is installed and logged in (same rules as /api/settings/agent-capabilities). */
export const isAgentAuthenticated = async (
  agentType: AgentType,
  claudeToken: string | null | undefined
): Promise<boolean> => {
  switch (agentType) {
    case 'claude':
      // Claude is available via ACP when a token is stored; the ACP package is always present
      return isClaudeAvailable(config.configDir) && !!claudeToken;
    case 'cursor-agent': {
      const { status } = await checkCursorAuth();
      return status === 'authenticated' || status === 'timeout';
    }
    case 'open-code':
      return openCodeAuthenticated();
    case 'codex':
      // Codex needs both the ACP binary (shipped in the image) and a stored API key
      return (await isCodexAcpAvailable(config.configDir)) && codexAuthenticated();
    case 'mistral-vibe':
      return (
        (await isVibeCliAvailable(config.configDir)) && getVibeApiKeyStatus(config.configDir).configured
      );
    default:
      return false;
  }
};

/**
 * `resolveAutomaticOneShotAgentType` with login checks resolved up front (its predicate is
 * sync; the Cursor check is async). Skips the checks when a utility agent is set explicitly.
 */
export const resolveAuthenticatedOneShotAgentType = async (
  utilityAgentType: string | null | undefined,
  candidates: Array<string | null | undefined>,
  claudeToken: string | null | undefined
): Promise<AgentType> => {
  const authenticated = new Set<AgentType>();
  if (!isOneShotAgentType(utilityAgentType)) {
    await Promise.all(
      ONE_SHOT_AGENT_TYPES.map(async (agentType) => {
        if (await isAgentAuthenticated(agentType, claudeToken)) authenticated.add(agentType);
      })
    );
  }
  return resolveAutomaticOneShotAgentType(utilityAgentType, candidates, (agentType) =>
    authenticated.has(agentType)
  );
};
