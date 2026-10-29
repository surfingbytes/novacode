/**
 * Canonical shared types for Nova Code — used by both the API and the dashboard.
 *
 * Single source of truth: previously api/src/@types/index.ts and
 * dashboard/src/@types/index.ts were hand-maintained copies and had drifted
 * (e.g. the API sent `claude_limit_detected` frames its own types didn't know).
 */

// types
import type {
  CreateWorkspaceBody,
  UpdateWorkspaceBody,
  WorkspaceResponse,
  WorkspaceUsageSummary
} from './apiSchemas/workspaces.js';

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
  /** Run state for this step ('running' while its session works). */
  runResult?: 'running' | 'done' | 'failed' | 'skipped';
  /** Why the step failed or what happened while merging it (parallel runs). */
  runNote?: string | null;
  /** Question the step's agent asked the user; the step waits for a reply in its session. */
  waitingQuestion?: string | null;
  /**
   * Auto-added steps: 'merge' applies the parallel steps' combined result to the
   * workspace, 'verify' is the final "check against spec" step.
   */
  kind?: 'verify' | 'merge';
  /**
   * Merge step: the integration branch of the last parallel run and the commit it
   * started from, kept while the merge hasn't succeeded so the step can be run again.
   */
  mergeRef?: { base: string; branch: string } | null;
}

export type OrchestratorRunMode = 'sequential' | 'parallel';

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
  /** Planning chat that owns this plan; its agent edits it through the nova MCP. */
  sourceSessionId?: string | null;
  /** Model for step sessions (agent type is `agentType`); null = planning chat's model. */
  workerModel?: string | null;
  /** Max steps at once in parallel runs. */
  maxParallel?: number;
  /** Agent for the final verify step; null = planning chat's agent. */
  verifyAgentType?: AgentType | null;
  /** Model for the final verify step; null = planning chat's model. */
  verifyModel?: string | null;
  runMode?: OrchestratorRunMode | string | null;
  /** Omitted on older API responses; treat as false. */
  isFavorite?: boolean;
  /** Run finished and nobody opened the plan since. */
  unread?: boolean;
}

/** Orchestrator without the planning chat (`GET /orchestrators`, sessions WS snapshot). */
export type OrchestratorSummary = Omit<Orchestrator, 'messageJson'>;

// ---------------------------------- Session spec ----------------------------------

export interface SessionSpecStatus {
  sessionId: string;
  /** Spec file exists on disk (it may still hold only the template). */
  exists: boolean;
  /** True when the file has content beyond the generated template header. */
  hasContent: boolean;
  /** Absolute path of the spec file (also told to the agent). */
  path: string;
  /** ISO mtime of the spec file. */
  updatedAt: string | null;
  /** Newest non-archived orchestrator planned in this session. */
  orchestratorId: string | null;
  /** Chat changed after the spec file was last written. */
  bChatNewerThanSpec: boolean;
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

// ---------------------------------- Sessions list WebSocket protocol ----------------------------------

/** Sent on the global sessions socket and the workspace socket when an automation run finishes. */
export interface AutomationRunFinishedMessage {
  type: 'automation-run-finished';
  automationId: string;
  workspaceId: string;
  automationName: string;
  status: 'success' | 'failed';
  error: string | null;
  finishedAt: string;
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
  /** Plan markdown for ExitPlanMode / approve-plan prompts — always shown to the user. */
  planMarkdown?: string;
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
  /** Hierarchical point label shown to the agent ("6", "5.3"); falls back to entryIndex + 1. */
  entryLabel?: string;
  entryContent: string;
  contextMode: LinkedPlanContextMode;
  /** Agent that produced the source plan; selects the plan-documents source. */
  sourceAgentType?: AgentType;
  /**
   * Inline full plan markdown when the source has no file-backed plan id
   * (e.g. Claude ACP stream plans). Preferred over disk lookup when set.
   */
  planMarkdown?: string;
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
    | 'question-resolved'
    | 'handoff-ready'
    | 'handoff-failed';
  messages?: ChatMessage[];
  data?: string;
  message?: string;
  code?: 'auth_required' | 'rate_limited' | 'timeout' | 'unknown';
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
  /** handoff-ready: the new chat that continues this one. */
  sessionId?: string;
}

// ---------------------------------- Entities ----------------------------------

/** Max workspaces that can be marked favorite (sidebar quick-start row). */
export const MAX_FAVORITE_WORKSPACES = 5;

/** API workspace payload (WorkspaceSchema) with `defaultAgentType` narrowed to known agents. */
export type Workspace = Omit<WorkspaceResponse, 'defaultAgentType'> & {
  defaultAgentType?: AgentType | null;
};

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
  isFavorite: boolean;
  busy?: boolean;
  /** Outstanding Task/subagent counts while `busy` (running of total launched this turn). */
  busySubagents?: { running: number; total: number } | null;
  /** True when a run finished while no client was viewing this session. Omitted on older API responses. */
  unread?: boolean;
  /** Orchestrator whose run created this session (step or merge chat); such chats are hidden from chat lists. */
  orchestratorId?: string | null;
  /** Set on chats started via "Continue in new chat": the source chat and its handoff summary. */
  continuedFrom?: SessionHandoffSource | null;
  /** Set on chats continued in a new chat: the id of that chat. */
  continuedInSessionId?: string | null;
}

export interface SessionHandoffSource {
  sessionId: string;
  sessionName: string;
  summary: string;
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

/** Token/cost totals for one session (sum of persisted usage turns). */
export type SessionUsageSummary = WorkspaceUsageSummary;

/** One spend bucket from Cursor dashboard `usage-summary` (values in cents). */
export interface CursorUsageBucket {
  enabled: boolean;
  usedCents: number;
  limitCents: number | null;
  remainingCents: number | null;
}

/**
 * Account usage from Cursor `GET /api/usage-summary`, authenticated with the
 * existing `cursor-agent login` token (not an Org/Admin API key).
 */
export interface CursorUsageSummaryResponse {
  authenticated: boolean;
  available: boolean;
  billingCycleStart?: string;
  billingCycleEnd?: string;
  membershipType?: string;
  limitType?: string;
  isUnlimited?: boolean;
  individual?: CursorUsageBucket;
  teamOnDemand?: CursorUsageBucket;
  error?: string;
  fetchedAt?: number;
}

/**
 * Git hosting provider for CI status. `gitea` and `forgejo` share one API; when adding a
 * connection either value means "Gitea-compatible" and the server detects which it is.
 */
export type ForgeProvider = 'gitea' | 'forgejo' | 'github' | 'gitlab';

/** A configured forge connection (the token is never sent to the browser). */
export interface ForgeConnectionStatus {
  id: string;
  name: string;
  provider: ForgeProvider;
  /** Web URL, e.g. `https://github.com` or `https://git.example.com`. */
  url: string;
  /** Extra hostnames used in git remotes (e.g. an SSH domain that differs from `url`). */
  remoteHosts: string[];
  version: string | null;
  source: 'env' | 'file';
}

export interface ForgeConnectionsResponse {
  connections: ForgeConnectionStatus[];
}

export interface SaveForgeConnectionPayload {
  provider: ForgeProvider;
  url: string;
  /** Required when creating; omit on update to keep the stored token. */
  token?: string;
  name?: string;
  remoteHosts?: string[];
}

export interface ForgeConnectionTestResult {
  ok: boolean;
  provider?: ForgeProvider;
  version?: string;
  username?: string;
  error?: string;
}

export type CiRunStatus = 'queued' | 'running' | 'success' | 'failure' | 'cancelled' | 'skipped' | 'unknown';

export interface CiRun {
  id: number;
  number: number | null;
  title: string;
  status: CiRunStatus;
  branch: string | null;
  sha: string | null;
  event: string | null;
  url: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CiStatusResponse {
  /** At least one forge connection exists. */
  configured: boolean;
  connectionId: string | null;
  connectionName: string | null;
  provider: ForgeProvider | null;
  /** Repository path on the forge (`owner/name`, or `group/sub/project` on GitLab). */
  repo: string | null;
  repoSource: 'override' | 'remote' | null;
  repoUrl: string | null;
  /** Forge page listing runs/pipelines for the repo. */
  runsUrl: string | null;
  branch: string | null;
  /** `actions` = workflow runs / pipelines API; `commit-status` = combined commit status fallback. */
  source: 'actions' | 'commit-status' | null;
  lastCompleted: CiRun | null;
  running: CiRun[];
  /** Newest-first, capped at the 3 oldest (next in line). */
  queued: CiRun[];
  queuedTotal: number;
  error?: string;
  fetchedAt: number;
}

export interface CiFixPromptResponse {
  prompt: string;
  /** False when job logs could not be fetched (prompt then only links to the run). */
  includesLogs: boolean;
}

export interface ForgeRepoDetectResponse {
  configured: boolean;
  connectionId: string | null;
  connectionName: string | null;
  provider: ForgeProvider | null;
  repo: string | null;
  source: 'override' | 'remote' | null;
}

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
  /** Whether the user finished or skipped the dashboard onboarding tour. */
  tourCompleted: boolean;
  /** ed25519 public key — add to your Git host for SSH git access */
  sshPublicKey: string;
  /** Whether the same keypair’s private key exists — fetch it via GET /api/settings/ssh-private-key */
  hasSshPrivateKey: boolean;
  /** Absolute workspace browse root inside the container (env WORKSPACE_BROWSE_ROOT). */
  workspaceBrowseRoot: string;
}

export interface McpClientServer {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** When false, kept in Settings but not loaded for agents. Default true. */
  enabled?: boolean;
}

/** Result of Settings → MCP “Test connectivity” dry-run */
export interface McpConnectivityCheckResult {
  ok: boolean;
  kind: 'stdio' | 'http';
  error?: string;
  detail?: string;
}

export interface McpSkippedServer {
  name: string;
  error: string;
}

/** Last MCP autoload probe (startup, save, or Test connectivity). */
export interface McpAutoloadStatus {
  status: 'pending' | 'ready';
  enabled: string[];
  skipped: McpSkippedServer[];
  probedAt: number | null;
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
  models?: OpenCodeProviderModel[];
  apiKey?: string;
}

/** Request body of POST /api/workspaces (CreateWorkspaceBodySchema). */
export type CreateWorkspacePayload = CreateWorkspaceBody;

/** Request body of PUT /api/workspaces/:id (UpdateWorkspaceBodySchema). */
export type UpdateWorkspacePayload = UpdateWorkspaceBody;
