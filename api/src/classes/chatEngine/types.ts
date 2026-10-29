// node_modules
import type { RequestPermissionResponse } from '@agentclientprotocol/sdk';

// classes
import type { AgentErrorCode } from '../agentError';
import type { AcpAskQuestionResponse } from '../acpSubprocessRunner';

// types
import type { ChatMessage, AgentType, ApprovalPolicy } from '../../@types/index';
import type {
  ChatApprovalRequest,
  ChatQuestionRequest,
  SessionUsageSnapshot,
} from '../../@types/index';

export interface ActiveRun {
  cancel: () => void;
  workspaceId: string;
  agentType: AgentType;
  acpSessionId: string | null;
  messages: ChatMessage[];
  assistantEvents: string[];
  bufferedLines: string[];
  subscribers: Set<ChatSubscriber>;
  pendingApprovals: Map<string, PendingApproval>;
  pendingQuestions: Map<string, PendingQuestion>;
  approvalPolicy: ApprovalPolicy;
  lastUsage: SessionUsageSnapshot | null;
  /** Outstanding Task/subagent counts while the run is busy. */
  backgroundTasks: { running: number; total: number } | null;
}

export interface ChatSubscriber {
  onStream(line: string): void;
  onDone(messages: ChatMessage[]): void;
  onError(message: string, code?: AgentErrorCode): void;
  onHistory(messages: ChatMessage[], streaming: boolean): void;
  onApprovalRequested?(approval: ChatApprovalRequest): void;
  onApprovalResolved?(approvalRequestId: string): void;
  onQuestionRequested?(question: ChatQuestionRequest): void;
  onQuestionResolved?(questionRequestId: string): void;
}

export interface PendingApproval {
  approval: ChatApprovalRequest;
  resolve: (response: RequestPermissionResponse) => void;
}

export interface PendingQuestion {
  question: ChatQuestionRequest;
  resolve: (response: AcpAskQuestionResponse) => void;
}

export type BusySubagents = { running: number; total: number };

export interface DispatchPromptOpts {
  sessionId: string;
  text: string;
  model?: string;
  mode?: string;
  imagePaths?: string[];
  subscriber: ChatSubscriber;
}
