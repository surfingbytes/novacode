/**
 * Cursor background Task subagents report nothing over ACP when they finish:
 * `cursor/task` arrives at launch and the subagent then only writes its own
 * transcript under `<configDir>/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl`
 * (first line = the Task prompt as a user message, `turn_ended` appended on completion).
 */

// node_modules
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

// classes
import { cursorProjectSlug } from './agentProjectCaches';
import { config } from './config';

const TAIL_BYTES = 4096;
const FIRST_LINE_BYTES = 64 * 1024;

export function cursorSubagentTranscriptsDir(cwd: string): string {
  return join(config.configDir, '.cursor', 'projects', cursorProjectSlug(cwd), 'agent-transcripts');
}

interface TrackedTranscript {
  path: string;
  size: number;
}

export interface SubagentTranscriptPoll {
  /** toolCallIds whose transcript recorded `turn_ended`. */
  finished: string[];
  /** True when any matched transcript grew since the last poll. */
  bActivity: boolean;
}

async function readRange(path: string, position: number, length: number): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function firstUserText(firstLine: string): string {
  try {
    const entry = JSON.parse(firstLine) as {
      role?: string;
      message?: { content?: Array<{ type?: string; text?: string }> };
    };
    if (entry.role !== 'user') return '';
    return (entry.message?.content ?? [])
      .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
      .join('\n');
  } catch {
    return '';
  }
}

export function createSubagentTranscriptWatcher(dir: string, startedAtMs: number) {
  const tracked = new Map<string, TrackedTranscript>();
  const claimedPaths = new Set<string>();

  const matchTranscript = async (prompt: string): Promise<TrackedTranscript | null> => {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return null;
    }
    for (const name of names) {
      const path = join(dir, name, `${name}.jsonl`);
      if (claimedPaths.has(path)) continue;
      try {
        const info = await stat(path);
        // Transcripts of older sessions in the same project cannot belong to this run.
        if (info.mtimeMs < startedAtMs) continue;
        const head = await readRange(path, 0, Math.min(info.size, FIRST_LINE_BYTES));
        if (!firstUserText(head.split('\n', 1)[0] ?? '').includes(prompt)) continue;
        claimedPaths.add(path);
        return { path, size: -1 };
      } catch {
        // file vanished or is mid-write; retry on the next poll
      }
    }
    return null;
  };

  const poll = async (prompts: Map<string, string>): Promise<SubagentTranscriptPoll> => {
    const finished: string[] = [];
    let bActivity = false;
    for (const [toolCallId, prompt] of prompts) {
      let transcript = tracked.get(toolCallId) ?? null;
      if (!transcript) {
        transcript = await matchTranscript(prompt.trim());
        if (!transcript) continue;
        tracked.set(toolCallId, transcript);
      }
      try {
        const info = await stat(transcript.path);
        if (info.size === transcript.size) continue;
        transcript.size = info.size;
        bActivity = true;
        const start = Math.max(0, info.size - TAIL_BYTES);
        const tail = await readRange(transcript.path, start, info.size - start);
        if (tail.includes('"type":"turn_ended"')) {
          finished.push(toolCallId);
          tracked.delete(toolCallId);
        }
      } catch {
        // retry on the next poll
      }
    }
    return { finished, bActivity };
  };

  return { poll };
}
