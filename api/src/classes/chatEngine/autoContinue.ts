// classes
import { db } from '../database';
import { logger } from '../logger';
import { dispatchPrompt } from './dispatch';

// types
import type { ChatSubscriber } from './types';

// ------------------------------------------ Claude Auto-Continue Scheduler ------------------------------------------

async function checkClaudeAutoContinue(): Promise<void> {
  logger.debug('Checking for Claude sessions to auto-continue');

  try {
    const users = await db.listUsers();
    const autoContinueUsers = users.filter((user) => user.claudeAutoContinue);

    if (autoContinueUsers.length === 0) {
      return;
    }

    const now = new Date();
    const sessions = await db.listSessions();

    for (const session of sessions) {
      if (!session.claudeLimitResetAt) continue;

      const resetTime = new Date(session.claudeLimitResetAt);
      const continueTime = new Date(resetTime);
      continueTime.setMinutes(continueTime.getMinutes() + 1);

      if (now >= continueTime) {
        logger.info({ sessionId: session.id }, 'Auto-continuing session after Claude limit reset');

        const mockSubscriber: ChatSubscriber = {
          onStream: () => {},
          onDone: () => logger.info({ sessionId: session.id }, 'Auto-continue completed'),
          onError: (message) => logger.error({ sessionId: session.id, message }, 'Auto-continue failed'),
          onHistory: () => {},
        };

        await dispatchPrompt({
          sessionId: session.id,
          text: 'continue',
          model: 'auto',
          mode: session.sessionMode,
          subscriber: mockSubscriber,
        });

        await db.updateSession(session.id, { claudeLimitResetAt: null });
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error in auto-continue checker');
  }
}

const AUTO_CONTINUE_INTERVAL_MS = 60 * 1000;
let autoContinueTimer: NodeJS.Timeout | undefined;

/**
 * Start the periodic Claude auto-continue check. Called from `index.ts` once the server is up;
 * importing this module (tests, `buildApp`) must not touch the database or start timers.
 */
export function startClaudeAutoContinue(): void {
  if (autoContinueTimer) return;
  autoContinueTimer = setInterval(() => void checkClaudeAutoContinue(), AUTO_CONTINUE_INTERVAL_MS);
  void checkClaudeAutoContinue();
}

export function stopClaudeAutoContinue(): void {
  clearInterval(autoContinueTimer);
  autoContinueTimer = undefined;
}
