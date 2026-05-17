// node_modules
import type { FastifyRequest, FastifyReply } from 'fastify';

// --------------------------------------------- Types ---------------------------------------------

export type AgentType = 'cursor-agent' | 'claude' | 'mistral-vibe' | 'open-code' | 'codex';

export interface SubTask {
  name: string;
  prompt: string;
  category?: string | null;
  /**
   * Optional ID of the workspace session that executed this subtask.
   * Populated by the orchestrator run logic when steps are run.
   */
  sessionId?: string | null;
}

/** Stored in `subtasks_json` as JSON object with `subtasks` array (legacy: raw array only). */
export interface OrchestratorSubtasksPayload {
  sharedContext: string;
  handoffLog: string;
  subtasks: SubTask[];
}
export type SessionStatus = 'running' | 'stopped' | 'failed' | 'error';

export interface WsClientMessage {
  type: 'input' | 'resize';
  data?: string;
  cols?: number;
  rows?: number;
}

export interface WsServerMessage {
  type: 'history' | 'output' | 'status' | 'server-shutdown';
  data?: string;
  status?: SessionStatus;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content?: string;
  events?: string[];
  /** absolute paths to images attached by the user (e.g. /prompt-images/<sessionId>/<file>) */
  imagePaths?: string[];
  createdAt: string;
}

export interface ChatQueueItem {
  id: string;
  sessionId: string;
  text: string;
  model: string;
  imagePaths?: string[];
  createdAt: string;
}

export interface ChatWsClientMessage {
  type: 'prompt' | 'cancel' | 'load-more' | 'queue-delete' | 'queue-push';
  text?: string;
  /** Model id (e.g. 'auto', 'gpt-5.3-codex'). Default 'auto'. */
  model?: string;
  offset?: number;
  imagePaths?: string[];
  queueItemId?: string;
}

export interface ChatWsServerMessage {
  type:
    | 'history'
    | 'history-page'
    | 'stream'
    | 'done'
    | 'error'
    | 'server-shutdown'
    | 'queue-updated'
    | 'prompt-started';
  messages?: ChatMessage[];
  data?: string;
  message?: string;
  streaming?: boolean;
  hasMore?: boolean;
  queue?: ChatQueueItem[];
  queueItemId?: string;
  prompt?: {
    text: string;
    imagePaths?: string[];
    createdAt: string;
  };
}

// Fastify module augmentation
declare module 'fastify' {
  interface FastifyInstance {
    verifyJwt: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    jwtUser: { id: string; username: string } | null;
  }
}
