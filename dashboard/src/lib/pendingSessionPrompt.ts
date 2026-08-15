/**
 * Draft prompts for sessions (plan handoff, composer) and orchestrators.
 * Memory wins for the immediate same-tab navigation; localStorage is
 * best-effort and capped so a full quota on mobile cannot fail session create.
 */

// lib
import {
  safeGetItem,
  safeLocalStorageKeys,
  safeRemoveItem,
  safeSetItem
} from '@/lib/safeLocalStorage';

const pending = new Map<string, string>();
const DRAFT_INDEX_KEY = 'nova:draftPromptIndex';
const MAX_DRAFT_PROMPTS = 20;
const MAX_DRAFT_CHARS = 32_000;
const SESSION_PREFIX = 'sessionPrompt:';
const ORCHESTRATOR_PREFIX = 'orchestratorPrompt:';

function memoryKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

export function sessionPromptStorageKey(workspaceId: string, sessionId: string): string {
  return `${SESSION_PREFIX}${workspaceId}:${sessionId}`;
}

export function orchestratorPromptStorageKey(
  workspaceId: string,
  orchestratorId: string
): string {
  return `${ORCHESTRATOR_PREFIX}${workspaceId}:${orchestratorId}`;
}

function isDraftKey(key: string): boolean {
  return key.startsWith(SESSION_PREFIX) || key.startsWith(ORCHESTRATOR_PREFIX);
}

function readDraftIndex(): string[] {
  const raw = safeGetItem(DRAFT_INDEX_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        return parsed;
      }
    } catch {
      // rebuild from existing keys below
    }
  }
  return safeLocalStorageKeys().filter(isDraftKey);
}

function writeDraftIndex(index: string[]): void {
  safeSetItem(DRAFT_INDEX_KEY, JSON.stringify(index));
}

function touchDraftIndex(storageKey: string): void {
  const index = readDraftIndex().filter((key) => key !== storageKey);
  index.unshift(storageKey);
  const evicted = index.splice(MAX_DRAFT_PROMPTS);
  for (const key of evicted) {
    safeRemoveItem(key);
  }
  writeDraftIndex(index);
}

function dropFromDraftIndex(storageKey: string): void {
  writeDraftIndex(readDraftIndex().filter((key) => key !== storageKey));
}

export function persistDraftPrompt(storageKey: string, prompt: string): void {
  if (!prompt) {
    clearDraftPrompt(storageKey);
    return;
  }
  const clipped = prompt.length > MAX_DRAFT_CHARS ? prompt.slice(0, MAX_DRAFT_CHARS) : prompt;
  if (safeSetItem(storageKey, clipped)) {
    touchDraftIndex(storageKey);
  }
}

export function readDraftPrompt(storageKey: string): string | null {
  return safeGetItem(storageKey);
}

export function clearDraftPrompt(storageKey: string): void {
  safeRemoveItem(storageKey);
  dropFromDraftIndex(storageKey);
}

export function setPendingSessionPrompt(
  workspaceId: string,
  sessionId: string,
  prompt: string
): void {
  const key = memoryKey(workspaceId, sessionId);
  if (!prompt) {
    pending.delete(key);
  } else {
    pending.set(key, prompt);
  }
  persistDraftPrompt(sessionPromptStorageKey(workspaceId, sessionId), prompt);
}

export function readSessionPrompt(workspaceId: string, sessionId: string): string | null {
  const key = memoryKey(workspaceId, sessionId);
  const memory = pending.get(key);
  if (memory !== undefined) {
    pending.delete(key);
    return memory;
  }
  return readDraftPrompt(sessionPromptStorageKey(workspaceId, sessionId));
}

export function persistSessionPrompt(
  workspaceId: string,
  sessionId: string,
  prompt: string
): void {
  persistDraftPrompt(sessionPromptStorageKey(workspaceId, sessionId), prompt);
}

export function clearSessionPrompt(workspaceId: string, sessionId: string): void {
  pending.delete(memoryKey(workspaceId, sessionId));
  clearDraftPrompt(sessionPromptStorageKey(workspaceId, sessionId));
}

export function persistOrchestratorPrompt(
  workspaceId: string,
  orchestratorId: string,
  prompt: string
): void {
  persistDraftPrompt(orchestratorPromptStorageKey(workspaceId, orchestratorId), prompt);
}

export function readOrchestratorPrompt(
  workspaceId: string,
  orchestratorId: string
): string | null {
  return readDraftPrompt(orchestratorPromptStorageKey(workspaceId, orchestratorId));
}

export function clearOrchestratorPrompt(workspaceId: string, orchestratorId: string): void {
  clearDraftPrompt(orchestratorPromptStorageKey(workspaceId, orchestratorId));
}

export function clearDraftsForEntityId(entityId: string): void {
  const suffix = `:${entityId}`;
  for (const key of safeLocalStorageKeys()) {
    if (isDraftKey(key) && key.endsWith(suffix)) {
      clearDraftPrompt(key);
    }
  }
  for (const key of pending.keys()) {
    if (key.endsWith(suffix)) {
      pending.delete(key);
    }
  }
}
