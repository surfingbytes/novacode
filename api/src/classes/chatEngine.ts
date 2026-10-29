// Public entry for the chat engine; implementation lives in ./chatEngine/.

/** @public */
export type { ActiveRun, BusySubagents, ChatSubscriber, DispatchPromptOpts } from './chatEngine/types';
export {
  appendPlanUpdateToActiveRun,
  getActiveBusySubagents,
  getActiveRun,
  getActiveSessionIds,
  isSessionBusy,
  subscribeBusy,
  unsubscribeBusy,
} from './chatEngine/state';
export { respondToAcpPermission, setActiveRunApprovalPolicy } from './chatEngine/approvals';
export { respondToAcpAskQuestion } from './chatEngine/questions';
export { cancelAllRuns, cancelRun, dispatchPrompt, dispatchPromptAndWait } from './chatEngine/dispatch';
export { startClaudeAutoContinue, stopClaudeAutoContinue } from './chatEngine/autoContinue';
