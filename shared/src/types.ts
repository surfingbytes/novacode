/**
 * Canonical shared types for Nova Code — used by both the API and the dashboard.
 *
 * Single source of truth: previously api/src/@types/index.ts and
 * dashboard/src/@types/index.ts were hand-maintained copies and had drifted
 * (e.g. the API sent `claude_limit_detected` frames its own types didn't know).
 */

// ---------------------------------- Agents ----------------------------------

export type AgentType = 'cursor-agent' | 'claude' | 'mistral-vibe' | 'open-code' | 'codex';

// ---------------------------------- Orchestrator ----------------------------------

export interface SubTask {
  name: string;
  prompt: string;
  category?: string | null;
  /**
   * Optional ID of the workspace session that executed this subtask.
   * Populated by the orchestrator run logic when steps are run.
   */
  sessionId?: string | null;
  /** 0-based indexes of steps that must succeed before this step runs. */
  dependsOn?: number[];
  /** Last run outcome for this step. */
  runResult?: 'done' | 'failed' | 'skipped';
}

/** Stored in `subtasksJson` as JSON object with `subtasks` array (legacy: raw array only). */
export interface OrchestratorSubtasksPayload {
  sharedContext: string;
  handoffLog: string;
  subtasks: SubTask[];
}

export interface Orchestrator {
  id: string;
  name: string;
  tags: string | null;
  agentType: AgentType;
  messageJson: string;
  subtasksJson: string | null;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  /** Omitted on older API responses; treat as false. */
  archived?: boolean;
  runStatus?: string | null;
  runCurrentStep?: number | null;
  runTotalSteps?: number | null;
  runStartedAt?: string | null;
}

// ---------------------------------- Terminal WebSocket protocol ----------------------------------

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

// ---------------------------------- Chat WebSocket protocol ----------------------------------

export interface ChatMessage {
  role: 'user' | 'assistant';
  content?: string;
  events?: string[];
  /** absolute paths to images attached by the user (e.g. /prompt-images/<sessionId>/<file>) */
  imagePaths?: string[];
  /** client-only: data URLs for optimistic display before the server round-trip */
  imageDataUrls?: string[];
  createdAt: string;
}

export interface ChatQueueItem {
  id: string;
  sessionId: string;
  text: string;
  model: string;
  mode: string;
  imagePaths?: string[];
  createdAt: string;
}

export type ChatApprovalOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

/** Nova-owned session policy for ACP tool permission prompts. */
export type ApprovalPolicy = 'ask' | 'allow_all';

export interface ChatApprovalOption {
  optionId: string;
  name: string;
  kind: ChatApprovalOptionKind;
}

export interface ChatApprovalRequest {
  id: string;
  sessionId: string;
  title: string;
  toolCallId?: string;
  toolName?: string;
  toolKind?: string;
  command?: string;
  cwd?: string;
  rawInput?: unknown;
  options: ChatApprovalOption[];
}

/** Cursor ACP cursor/ask_question option. */
export interface ChatQuestionOption {
  id: string;
  label: string;
}

/** Cursor ACP cursor/ask_question item. */
export interface ChatQuestionItem {
  id: string;
  prompt: string;
  options: ChatQuestionOption[];
  allowMultiple?: boolean;
}

/** Nova-owned pending AskQuestion prompt surfaced in chat. */
export interface ChatQuestionRequest {
  id: string;
  sessionId: string;
  toolCallId: string;
  title?: string;
  questions: ChatQuestionItem[];
}

export interface ChatQuestionAnswer {
  questionId: string;
  selectedOptionIds: string[];
}

export type LinkedPlanContextMode = 'target-only' | 'full';

export interface LinkedPlanContext {
  sourceSessionId: string;
  sourceAcpSessionId: string;
  planId: string;
  planTitle: string;
  entryIndex: number;
  entryContent: string;
  contextMode: LinkedPlanContextMode;
  /** Agent that produced the source plan; selects the plan-documents source. */
  sourceAgentType?: AgentType;
}

export interface ChatWsClientMessage {
  type:
    | 'prompt'
    | 'cancel'
    | 'load-more'
    | 'queue-delete'
    | 'queue-push'
    | 'queue-edit'
    | 'approval-response'
    | 'question-response';
  text?: string;
  /** Model id (e.g. 'auto', 'gpt-5.3-codex'). Default 'auto'. */
  model?: string;
  /** Session mode id for this prompt. */
  mode?: string;
  offset?: number;
  imagePaths?: string[];
  queueItemId?: string;
  approvalRequestId?: string;
  approvalOptionId?: string;
  questionRequestId?: string;
  /** When true, skip answering and let the agent continue. */
  questionSkipped?: boolean;
  questionAnswers?: ChatQuestionAnswer[];
}

export interface ChatWsServerMessage {
  type:
    | 'history'
    | 'history-page'
    | 'stream'
    | 'done'
    | 'claude_limit_detected'
    | 'error'
    | 'server-shutdown'
    | 'queue-updated'
    | 'prompt-started'
    | 'approval-requested'
    | 'approval-resolved'
    | 'question-requested'
    | 'question-resolved';
  messages?: ChatMessage[];
  data?: string;
  message?: string;
  code?: 'auth_required' | 'timeout' | 'unknown';
  streaming?: boolean;
  hasMore?: boolean;
  queue?: ChatQueueItem[];
  approval?: ChatApprovalRequest;
  approvalRequestId?: string;
  question?: ChatQuestionRequest;
  questionRequestId?: string;
  queueItemId?: string;
  prompt?: {
    text: string;
    imagePaths?: string[];
    createdAt: string;
  };
  resetTime?: string;
  resetTimeReadable?: string;
}

// ---------------------------------- Entities ----------------------------------

/** Max workspaces that can be marked favorite (sidebar quick-start row). */
export const MAX_FAVORITE_WORKSPACES = 5;

export interface Workspace {
  id: string;
  name: string;
  path: string;
  group?: string | null;
  createdAt: string;
  gitUserName?: string | null;
  gitUserEmail?: string | null;
  color?: string | null;
  sortOrder?: number | null;
  defaultAgentType?: AgentType | null;
  tags?: string[] | null;
  archived: boolean;
  isFavorite: boolean;
  favoriteOrder?: number | null;
}

export interface PlanDocumentSummary {
  id: string;
  sessionId: string;
  title: string;
  markdown: string;
}

export interface Session {
  id: string;
  name: string;
  tags: string[] | null;
  sessionId: string | null;
  agentType: AgentType;
  modelSelection: string;
  sessionMode: string;
  /** Nova chat approval policy: ask before tools, or auto-allow. */
  approvalPolicy: ApprovalPolicy;
  sessionConfigJson?: Record<string, string> | null;
  /** Legacy field; chat history is no longer returned on session payloads (it streams over the chat WebSocket). */
  messageJson?: string;
  /** Real Cursor plan documents from .cursor/plans, present on session detail when available */
  planDocuments?: PlanDocumentSummary[];
  /** Denormalized last chat line for sidebars (from API list / WebSocket) */
  lastPreviewText?: string | null;
  lastPreviewRole?: 'user' | 'assistant' | null;
  /** Latest token/cost snapshot from an ACP `usage_update` (omitted when the agent never reported usage). */
  lastUsage?: SessionUsageSnapshot | null;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  busy?: boolean;
  /** True when a run finished while no client was viewing this session. Omitted on older API responses. */
  unread?: boolean;
}

/** Token/cost snapshot reported by an agent (ACP `usage_update`). */
export interface SessionUsageSnapshot {
  used: number;
  size: number;
  cost?: { amount: number; currency: string };
  at?: string;
}

/** One persisted usage sample (typically one per completed agent turn). */
export interface SessionUsageTurn extends SessionUsageSnapshot {
  id: string;
  sessionId: string;
  createdAt: string;
}

export interface WorkspaceUsageSummary {
  turnCount: number;
  used: number;
  size: number;
  costAmount: number | null;
  costCurrency: string | null;
}

/** Token/cost totals for one session (sum of persisted usage turns). */
export type SessionUsageSummary = WorkspaceUsageSummary;

/** Stored API key metadata. The plaintext token is only returned once, on create. */
export interface ApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreatedApiToken extends ApiToken {
  token: string;
}

export interface RoleTemplate {
  id: string;
  name: string;
  description: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Automation {
  id: string;
  name: string;
  workspaceId: string;
  agentType: AgentType;
  prompt: string;
  intervalMinutes: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus?: 'running' | 'completed' | 'failed' | null;
  lastRunError?: string | null;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'completed' | 'failed';
  agentResponse: string | null;
  changedFiles: string | null; // json array of { status, file }
  error: string | null;
  sessionId?: string | null;
}

// ---------------------------------- API DTOs ----------------------------------

export interface AgentConfigOption {
  id: string;
  label: string;
  description?: string;
  category?: string;
  currentValue?: string;
  options: Array<{ value: string; label: string; description?: string }>;
}

export interface AgentThinkingOptionGroup {
  configId: string;
  label: string;
  description?: string;
  currentValue?: string;
  options: Array<{ value: string; label: string; description?: string }>;
}

export interface AgentModeOption {
  id: string;
  label: string;
  description?: string;
  current?: boolean;
}

export interface AgentModelOption {
  id: string;
  label: string;
  model: string;
  thinking: string;
  context: string;
  fast: boolean | null;
  current?: boolean;
}

export interface AgentOptionsResponse {
  models: AgentModelOption[];
  modes: AgentModeOption[];
  configOptions: AgentConfigOption[];
  thinking: AgentThinkingOptionGroup | null;
  fromCache: boolean;
  source: 'cli' | 'acp' | 'mixed' | 'static';
}

export interface WorkspaceRuleFileSummary {
  filename: string;
  label: string | null;
}

export interface WorkspaceRuleFileContent {
  filename: string;
  content: string;
}

export interface AppSettings {
  gitUserName: string | null;
  gitUserEmail: string | null;
  theme: string;
  autoTheme: boolean;
  darkTheme: string;
  lightTheme: string;
  modelSelection: string;
  claudeAutoContinue: boolean;
  /** Agent for automatic commit messages and session titles. Null inherits workspace/session. */
  utilityAgentType: AgentType | null;
  /** Model for those short tasks. Empty picks Composer/Haiku, then Auto. */
  utilityModelSelection: string;
  /** ed25519 public key — add to your Git host for SSH git access */
  sshPublicKey: string;
  /** Same keypair’s private key — secret; stored on server config volume */
  sshPrivateKey: string;
}

export interface McpClientServer {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/** Result of Settings → MCP “Test connectivity” dry-run */
export interface McpConnectivityCheckResult {
  ok: boolean;
  kind: 'stdio' | 'http';
  error?: string;
  detail?: string;
}

export type OpenCodeProviderAdapter = 'openai-compatible' | 'openai' | 'custom';

export interface OpenCodeProviderModel {
  id: string;
  name: string;
}

export interface OpenCodeProvider {
  id: string;
  name: string;
  npm: string;
  adapter: OpenCodeProviderAdapter;
  baseURL: string;
  models: OpenCodeProviderModel[];
  authenticated: boolean;
}

export interface SaveOpenCodeProviderPayload {
  id: string;
  name: string;
  adapter: OpenCodeProviderAdapter;
  npm?: string;
  baseURL: string;
  models: OpenCodeProviderModel[];
  apiKey?: string;
}

export interface CreateWorkspacePayload {
  name: string;
  path: string;
  group?: string | null;
  gitUserName?: string | null;
  gitUserEmail?: string | null;
  color?: string | null;
  defaultAgentType?: AgentType | null;
  tags?: string[] | null;
}

export interface UpdateWorkspacePayload {
  name?: string;
  path?: string;
  group?: string | null;
  gitUserName?: string | null;
  gitUserEmail?: string | null;
  color?: string | null;
  defaultAgentType?: AgentType | null;
  tags?: string[] | null;
  isFavorite?: boolean;
}
