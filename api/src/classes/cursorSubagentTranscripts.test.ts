// node_modules
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// classes
import { createSubagentTranscriptWatcher } from './cursorSubagentTranscripts';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function writeTranscript(dir: string, id: string, prompt: string, bEnded: boolean): string {
  mkdirSync(join(dir, id), { recursive: true });
  const path = join(dir, id, `${id}.jsonl`);
  appendFileSync(
    path,
    JSON.stringify({
      role: 'user',
      message: { content: [{ type: 'text', text: `<timestamp>now</timestamp>\n<user_query>\n${prompt}\n</user_query>` }] },
    }) + '\n'
  );
  if (bEnded) appendFileSync(path, JSON.stringify({ type: 'turn_ended', status: 'success' }) + '\n');
  return path;
}

describe('createSubagentTranscriptWatcher', () => {
  it('finishes a task once its matching transcript records turn_ended', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'subagent-transcripts-'));
    tempDirs.push(dir);
    const watcher = createSubagentTranscriptWatcher(dir, Date.now() - 1_000);
    const prompts = new Map([['task-1', 'Research auth.']]);

    expect(await watcher.poll(prompts)).toEqual({ finished: [], bActivity: false });

    const path = writeTranscript(dir, 'a', 'Research auth.', false);
    writeTranscript(dir, 'b', 'Something else.', true);
    expect(await watcher.poll(prompts)).toEqual({ finished: [], bActivity: true });
    expect(await watcher.poll(prompts)).toEqual({ finished: [], bActivity: false });

    appendFileSync(path, JSON.stringify({ type: 'turn_ended', status: 'success' }) + '\n');
    expect(await watcher.poll(prompts)).toEqual({ finished: ['task-1'], bActivity: true });
  });

  it('ignores transcripts last written before the run started', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'subagent-transcripts-'));
    tempDirs.push(dir);
    const path = writeTranscript(dir, 'old', 'Research auth.', true);
    const past = new Date(Date.now() - 60_000);
    utimesSync(path, past, past);
    const watcher = createSubagentTranscriptWatcher(dir, Date.now() - 1_000);

    expect(await watcher.poll(new Map([['task-1', 'Research auth.']]))).toEqual({
      finished: [],
      bActivity: false,
    });
  });

  it('claims a separate transcript per task when prompts are identical', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'subagent-transcripts-'));
    tempDirs.push(dir);
    writeTranscript(dir, 'a', 'Same prompt.', true);
    const watcher = createSubagentTranscriptWatcher(dir, Date.now() - 1_000);
    const prompts = new Map([
      ['task-1', 'Same prompt.'],
      ['task-2', 'Same prompt.'],
    ]);

    expect((await watcher.poll(prompts)).finished).toEqual(['task-1']);
    prompts.delete('task-1');
    writeTranscript(dir, 'b', 'Same prompt.', true);
    expect((await watcher.poll(prompts)).finished).toEqual(['task-2']);
  });
});
