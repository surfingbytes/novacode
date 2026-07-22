// node_modules
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// classes
import { config } from './config';
import { listPlanDocumentsForAcpSession, getPlanDocumentById } from './planDocuments';
import {
  buildOpenCodePlanModeInstruction,
  getPlanDocumentsSource,
  openCodePlansDir,
} from './planDocumentSources';

// ---------------------------------- Engine (planDocuments) ----------------------------------

describe('planDocuments engine', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'plan-docs-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const convention = {
    get dir() {
      return dir;
    },
    matches: (name: string) => name.endsWith('.md'),
    isSafeId: (id: string) => /^[^/\\]+\.md$/.test(id),
  };

  function writePlan(name: string, sessionId: string, body = '# Title\n\nBody'): void {
    writeFileSync(join(dir, name), `<!-- ${sessionId} -->\n${body}\n`, 'utf8');
  }

  it('associates plans with uuid-style session ids (cursor)', async () => {
    const uuid = '01f325bd-4142-4f69-9cc2-112f244fc5ca';
    writePlan('a.md', uuid);
    writePlan('b.md', '9d1b62f0-0000-4000-8000-111111111111');
    const docs = await listPlanDocumentsForAcpSession(convention, uuid);
    expect(docs.map((d) => d.id)).toEqual(['a.md']);
    expect(docs[0]?.sessionId).toBe(uuid);
    expect(docs[0]?.title).toBe('Title');
  });

  it('associates plans with ses_-style session ids (open-code)', async () => {
    writePlan('plan.md', 'ses_074882535ffewYk66ePlY2178N');
    const docs = await listPlanDocumentsForAcpSession(convention, 'ses_074882535ffewYk66ePlY2178N');
    expect(docs).toHaveLength(1);
    expect(docs[0]?.markdown).toBe('# Title\n\nBody');
  });

  it('skips files without a session-id comment', async () => {
    writeFileSync(join(dir, 'untagged.md'), '# No tag\n', 'utf8');
    const docs = await listPlanDocumentsForAcpSession(convention, 'anything');
    expect(docs).toEqual([]);
  });

  it('reads a single plan by id with traversal guard', async () => {
    writePlan('one.md', 'sess-1');
    expect((await getPlanDocumentById(convention, 'one.md', { sessionId: 'sess-1' }))?.id).toBe('one.md');
    expect(await getPlanDocumentById(convention, '../one.md', { sessionId: 'sess-1' })).toBeNull();
    expect(await getPlanDocumentById(convention, 'one.md', { sessionId: 'other' })).toBeNull();
  });
});

// ---------------------------------- Per-agent sources ----------------------------------

describe('getPlanDocumentsSource', () => {
  let tmp: string;
  let savedXdg: string | undefined;
  let savedConfigDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'plan-src-'));
    savedXdg = process.env['XDG_DATA_HOME'];
    savedConfigDir = config.configDir;
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env['XDG_DATA_HOME'];
    else process.env['XDG_DATA_HOME'] = savedXdg;
    config.configDir = savedConfigDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns a noop source for agents without a plan-file convention', async () => {
    for (const agentType of ['claude', 'mistral-vibe', 'codex', undefined, null] as const) {
      const source = getPlanDocumentsSource(agentType);
      expect(await source.listForSession('whatever')).toEqual([]);
      expect(await source.getById('x.md', 'whatever')).toBeNull();
    }
  });

  it('reads cursor plans from <configDir>/.cursor/plans (*.plan.md only)', async () => {
    config.configDir = tmp;
    const plansDir = join(tmp, '.cursor', 'plans');
    mkdirSync(plansDir, { recursive: true });
    const uuid = '01f325bd-4142-4f69-9cc2-112f244fc5ca';
    writeFileSync(join(plansDir, `Roadmap-01f325bd.plan.md`), `<!-- ${uuid} -->\n# Roadmap\n`, 'utf8');
    // non-cursor suffix must be ignored by the cursor source
    writeFileSync(join(plansDir, `other.md`), `<!-- ${uuid} -->\n# Other\n`, 'utf8');

    const docs = await getPlanDocumentsSource('cursor-agent').listForSession(uuid);
    expect(docs.map((d) => d.id)).toEqual(['Roadmap-01f325bd.plan.md']);
  });

  it('reads open-code plans from <XDG_DATA_HOME>/opencode/plans (*.md)', async () => {
    process.env['XDG_DATA_HOME'] = tmp;
    const plansDir = join(tmp, 'opencode', 'plans');
    mkdirSync(plansDir, { recursive: true });
    const acpSessionId = 'ses_074882535ffewYk66ePlY2178N';
    writeFileSync(join(plansDir, 'add-greet.md'), `<!-- ${acpSessionId} -->\n# Add greet\n\nSteps…\n`, 'utf8');
    writeFileSync(join(plansDir, 'foreign.md'), `<!-- ses_other -->\n# Nope\n`, 'utf8');

    const source = getPlanDocumentsSource('open-code');
    const docs = await source.listForSession(acpSessionId);
    expect(docs.map((d) => d.id)).toEqual(['add-greet.md']);
    expect(docs[0]?.title).toBe('Add greet');
    expect((await source.getById('add-greet.md', acpSessionId))?.markdown).toContain('Steps…');
  });

  it('resolves the open-code plans dir under configDir when XDG_DATA_HOME is unset', () => {
    delete process.env['XDG_DATA_HOME'];
    config.configDir = tmp;
    expect(openCodePlansDir()).toBe(join(tmp, '.local', 'share', 'opencode', 'plans'));
  });
});

// ---------------------------------- Plan-mode prompt injection ----------------------------------

describe('buildOpenCodePlanModeInstruction', () => {
  it('embeds the plans dir and the session-id comment convention', () => {
    process.env['XDG_DATA_HOME'] = '/tmp/xdg-test';
    const text = buildOpenCodePlanModeInstruction('ses_abc123');
    expect(text).toContain('/tmp/xdg-test/opencode/plans');
    expect(text).toContain('<!-- ses_abc123 -->');
    expect(text).toContain('plan');
    delete process.env['XDG_DATA_HOME'];
  });
});
