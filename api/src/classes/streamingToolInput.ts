// classes
import { asRecord } from './acpSessionHelpers';

/**
 * Idle cap while a tool call's input is still streaming. The ACP adapter refines
 * a pending tool call only when a top-level input field completes, so a long last
 * field (e.g. the `steps` array of orchestrator_save_plan) looks like silence to
 * the no-output watchdog even though the model is writing the whole time.
 */
export const STREAMING_INPUT_IDLE_TIMEOUT_MS = 20 * 60_000;

/** The idle timeout to arm: the configured one, stretched while tool input streams. */
export function effectivePromptIdleTimeoutMs(configuredMs: number, bStreamingInput: boolean): number {
  if (configuredMs <= 0 || !bStreamingInput) return configuredMs;
  return Math.max(configuredMs, STREAMING_INPUT_IDLE_TIMEOUT_MS);
}

/**
 * Tracks tool calls whose input has not finished streaming: from their `pending`
 * `tool_call` until the first update that carries a status. The adapter sends no
 * status when the input completes, so the window also covers the run of a tool
 * that reports no progress; the normal timeout resumes once it settles.
 */
export class StreamingToolInputTracker {
  private readonly pending = new Set<string>();

  get bStreaming(): boolean {
    return this.pending.size > 0;
  }

  observe(line: string): void {
    let event: Record<string, unknown> | null;
    try {
      event = asRecord(JSON.parse(line));
    } catch {
      return;
    }
    const update = asRecord(event?.update);
    const toolCallId = typeof update?.toolCallId === 'string' ? update.toolCallId : null;
    if (!update || !toolCallId) return;
    const status = typeof update.status === 'string' ? update.status.toLowerCase() : '';

    if (update.sessionUpdate === 'tool_call') {
      if (status === 'pending') this.pending.add(toolCallId);
      else this.pending.delete(toolCallId);
      return;
    }
    if (update.sessionUpdate === 'tool_call_update' && status) {
      this.pending.delete(toolCallId);
    }
  }
}
