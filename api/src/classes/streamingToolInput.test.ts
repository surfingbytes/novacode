import { describe, expect, it } from 'vitest';

import { STREAMING_INPUT_IDLE_TIMEOUT_MS, StreamingToolInputTracker, effectivePromptIdleTimeoutMs } from './streamingToolInput';

function line(update: Record<string, unknown>): string {
  return JSON.stringify({ sessionId: 'acp-1', update });
}

describe('StreamingToolInputTracker', () => {
  it('streams from a pending tool_call until an update carries a status', () => {
    const tracker = new StreamingToolInputTracker();
    expect(tracker.bStreaming).toBe(false);

    tracker.observe(line({ sessionUpdate: 'tool_call', toolCallId: 't1', status: 'pending', rawInput: {} }));
    expect(tracker.bStreaming).toBe(true);

    // Partial refinements carry no status: still streaming.
    tracker.observe(line({ sessionUpdate: 'tool_call_update', toolCallId: 't1', rawInput: { name: 'Plan' } }));
    expect(tracker.bStreaming).toBe(true);

    tracker.observe(line({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' }));
    expect(tracker.bStreaming).toBe(false);
  });

  it('ignores tool calls that start with a status other than pending', () => {
    const tracker = new StreamingToolInputTracker();
    tracker.observe(line({ sessionUpdate: 'tool_call', toolCallId: 't1', status: 'in_progress' }));
    expect(tracker.bStreaming).toBe(false);
  });

  it('ignores lines that are not JSON or not tool calls', () => {
    const tracker = new StreamingToolInputTracker();
    tracker.observe('not json');
    tracker.observe(line({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'x' } }));
    expect(tracker.bStreaming).toBe(false);
  });
});

describe('effectivePromptIdleTimeoutMs', () => {
  it('keeps the configured timeout when nothing streams or the watchdog is off', () => {
    expect(effectivePromptIdleTimeoutMs(300_000, false)).toBe(300_000);
    expect(effectivePromptIdleTimeoutMs(0, true)).toBe(0);
  });

  it('stretches a short timeout while tool input streams, never shortens a long one', () => {
    expect(effectivePromptIdleTimeoutMs(300_000, true)).toBe(STREAMING_INPUT_IDLE_TIMEOUT_MS);
    expect(effectivePromptIdleTimeoutMs(60 * 60_000, true)).toBe(60 * 60_000);
  });
});
