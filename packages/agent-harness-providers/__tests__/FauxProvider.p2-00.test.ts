// ────────────────────────────────────────────────────────────────
// P2-00 — FauxProvider additions:
//   - FAUX_MODELS / getModels() (shared with HarnessRegistry's synthetic
//     'faux' status)
//   - 'file_edit' script entries (real writes under workingDirectory)
//   - 'ask_question' / 'permission_request' script entries (drive
//     CreateConversationParams.onQuestionRequest / onPermissionRequest)
//   - GENERATORAI_TEST_FAUX_SCRIPT — scriptSource: load a fixture file
//     keyed by conversation name
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FauxProvider, FAUX_MODELS } from '../src/providers/faux/FauxProvider.js';
import type { AgentEvent, AgentQuestionResponse } from '@generatorai/shared';
import type { PermissionResponse } from '@generatorai/core';

describe('FauxProvider — FAUX_MODELS / getModels (P2-00)', () => {
  it('getModels() returns the shared FAUX_MODELS catalog', async () => {
    const faux = new FauxProvider();
    const models = await faux.getModels();
    expect(models).toEqual(FAUX_MODELS);
    expect(models.length).toBeGreaterThan(0);
  });
});

describe('FauxProvider — "file_edit" script entries (P2-00)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'faux-file-edit-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates a new file relative to workingDirectory and emits a tool card', async () => {
    const faux = new FauxProvider();
    await faux.initialize();
    await faux.createConversation({ conversationId: 'c1', workingDirectory: dir });

    const events: AgentEvent[] = [];
    faux.onConversationEvent('c1', (e) => events.push(e));

    faux.script([
      { type: 'file_edit', path: 'src/hello.ts', content: 'export const x = 1;\n' },
      { type: 'complete' },
    ], 'c1');

    await faux.sendPromptAndWait('c1', 'write the file');

    const written = await readFile(join(dir, 'src', 'hello.ts'), 'utf8');
    expect(written).toBe('export const x = 1;\n');

    const start = events.find((e): e is Extract<AgentEvent, { kind: 'harness.tool_start' }> => e.kind === 'harness.tool_start');
    const complete = events.find((e): e is Extract<AgentEvent, { kind: 'harness.tool_complete' }> => e.kind === 'harness.tool_complete');
    expect(start?.data.tool).toBe('Write');
    expect(complete?.data.success).toBe(true);
    expect(complete?.data.fileOp?.kind).toBe('create');
    expect(complete?.data.fileOp?.filePath).toBe('src/hello.ts');
  });

  it('updates an existing file and reports fileOp.kind "update"', async () => {
    await writeFile(join(dir, 'existing.txt'), 'line1\nline2\n', 'utf8');

    const faux = new FauxProvider();
    await faux.initialize();
    await faux.createConversation({ conversationId: 'c2', workingDirectory: dir });
    faux.script([
      { type: 'file_edit', path: 'existing.txt', content: 'line1\nline2\nline3\n' },
      { type: 'complete' },
    ], 'c2');

    await faux.sendPromptAndWait('c2', 'edit it');

    const written = await readFile(join(dir, 'existing.txt'), 'utf8');
    expect(written).toBe('line1\nline2\nline3\n');
  });

  it('deletes a file when op is "delete"', async () => {
    const target = join(dir, 'gone.txt');
    await writeFile(target, 'bye\n', 'utf8');

    const faux = new FauxProvider();
    await faux.initialize();
    await faux.createConversation({ conversationId: 'c3', workingDirectory: dir });
    faux.script([
      { type: 'file_edit', path: 'gone.txt', op: 'delete' },
      { type: 'complete' },
    ], 'c3');

    await faux.sendPromptAndWait('c3', 'delete it');

    await expect(readFile(target, 'utf8')).rejects.toThrow();
  });
});

describe('FauxProvider — "ask_question" / "permission_request" script entries (P2-00)', () => {
  it('calls onQuestionRequest and continues the script once answered', async () => {
    const faux = new FauxProvider();
    await faux.initialize();

    const response: AgentQuestionResponse = { answers: { q1: ['Yes'] } };
    let received: unknown;
    await faux.createConversation({
      conversationId: 'q1',
      onQuestionRequest: async (request) => {
        received = request;
        return response;
      },
    });

    faux.script([
      { type: 'ask_question', questions: [{ id: 'q1', header: 'Confirm', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }], multiSelect: false, allowFreeform: false }] },
      { type: 'text', content: 'Continuing.' },
      { type: 'complete' },
    ], 'q1');

    const result = await faux.sendPromptAndWait('q1', 'go');
    expect(received).toEqual({ questions: [{ id: 'q1', header: 'Confirm', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }], multiSelect: false, allowFreeform: false }] });
    expect(result.content).toContain('Continuing');
  });

  it('emits harness.warning and continues when no onQuestionRequest handler is installed', async () => {
    const faux = new FauxProvider();
    await faux.initialize();
    await faux.createConversation({ conversationId: 'q2' });

    const events: AgentEvent[] = [];
    faux.onConversationEvent('q2', (e) => events.push(e));

    faux.script([
      { type: 'ask_question', questions: [] },
      { type: 'text', content: 'Still here.' },
      { type: 'complete' },
    ], 'q2');

    const result = await faux.sendPromptAndWait('q2', 'go');
    expect(events.some((e) => e.kind === 'harness.warning')).toBe(true);
    expect(result.content).toContain('Still here');
  });

  it('calls onPermissionRequest and continues the script once resolved', async () => {
    const faux = new FauxProvider();
    await faux.initialize();

    const decision: PermissionResponse = { granted: true };
    let received: unknown;
    await faux.createConversation({
      conversationId: 'p1',
      onPermissionRequest: async (request) => {
        received = request;
        return decision;
      },
    });

    faux.script([
      { type: 'permission_request', request: { type: 'shell_exec', description: 'run tests' } },
      { type: 'text', content: 'Approved.' },
      { type: 'complete' },
    ], 'p1');

    const result = await faux.sendPromptAndWait('p1', 'go');
    expect(received).toEqual({ type: 'shell_exec', description: 'run tests' });
    expect(result.content).toContain('Approved');
  });
});

describe('FauxProvider — GENERATORAI_TEST_FAUX_SCRIPT (scriptSource, P2-00)', () => {
  let dir: string;
  let scriptFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'faux-script-file-'));
    scriptFile = join(dir, 'fixture.faux.json');
    await writeFile(
      scriptFile,
      JSON.stringify({
        'My Seeded Chat': [
          [{ type: 'text', content: 'Hello from the fixture.' }, { type: 'complete' }],
        ],
      }),
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('applies the turn-script matching the resolved conversation name', async () => {
    const faux = new FauxProvider({
      scriptSource: {
        filePath: scriptFile,
        resolveConversationName: async (id) => (id === 'conv-1' ? 'My Seeded Chat' : undefined),
      },
    });
    await faux.initialize();
    await faux.createConversation({ conversationId: 'conv-1' });

    const result = await faux.sendPromptAndWait('conv-1', 'hi');
    expect(result.content).toContain('Hello from the fixture');
  });

  it('resolves the name lazily on the first sendPromptAndWait, not at createConversation — so a caller that only makes the name resolvable AFTER createConversation returns (e.g. ChatManagementService persisting its chat row after calling harness.createConversation) still gets scripted', async () => {
    let rowPersisted = false;
    const faux = new FauxProvider({
      scriptSource: {
        filePath: scriptFile,
        resolveConversationName: async (id) => {
          // Simulates a caller whose "chat row" isn't queryable yet at the
          // moment createConversation() is called.
          if (id === 'conv-4' && rowPersisted) return 'My Seeded Chat';
          return undefined;
        },
      },
    });
    await faux.initialize();
    await faux.createConversation({ conversationId: 'conv-4' }); // row NOT yet "persisted"
    rowPersisted = true; // ...now it is, before the first prompt

    const result = await faux.sendPromptAndWait('conv-4', 'hi');
    expect(result.content).toContain('Hello from the fixture');
  });

  it('leaves the conversation unscripted when the name has no fixture entry', async () => {
    const faux = new FauxProvider({
      scriptSource: {
        filePath: scriptFile,
        resolveConversationName: async () => 'Some Other Chat',
      },
    });
    await faux.initialize();
    await faux.createConversation({ conversationId: 'conv-2' });

    const result = await faux.sendPromptAndWait('conv-2', 'hi');
    expect(result.content).toBe('');
  });

  it('does not throw and leaves the conversation unscripted when the file is missing', async () => {
    const warnings: string[] = [];
    const faux = new FauxProvider({
      scriptSource: {
        filePath: join(dir, 'does-not-exist.json'),
        resolveConversationName: async () => 'My Seeded Chat',
        logger: { warn: (m) => warnings.push(m) },
      },
    });
    await faux.initialize();
    // The script file is consulted lazily, on the first sendPromptAndWait —
    // not at createConversation — see that method's comment (P2-00: it
    // must not race ChatManagementService persisting the chat row).
    await expect(faux.createConversation({ conversationId: 'conv-3' })).resolves.toBe('conv-3');
    expect(warnings.length).toBe(0);
    const result = await faux.sendPromptAndWait('conv-3', 'hi');
    expect(result.content).toBe('');
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('FauxProvider — "file_edit" workspace containment (P2-R21a)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'faux-workspace-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('errors the step instead of falling back to process.cwd() when workingDirectory is unset', async () => {
    const faux = new FauxProvider();
    await faux.initialize();
    await faux.createConversation({ conversationId: 'no-workspace' }); // no workingDirectory

    const events: AgentEvent[] = [];
    faux.onConversationEvent('no-workspace', (e) => events.push(e));
    faux.script([
      { type: 'file_edit', path: 'hello.ts', content: 'export const x = 1;\n' },
      { type: 'complete' },
    ], 'no-workspace');

    await expect(faux.sendPromptAndWait('no-workspace', 'write it')).rejects.toThrow(/workingDirectory/);
    expect(events.some((e) => e.kind === 'harness.error')).toBe(true);
    // Never written anywhere, including this process's real cwd.
    await expect(readFile(join(process.cwd(), 'hello.ts'), 'utf8')).rejects.toThrow();
  });

  it('rejects a path that escapes the workspace via ".."', async () => {
    const faux = new FauxProvider();
    await faux.initialize();
    await faux.createConversation({ conversationId: 'escape', workingDirectory: dir });

    const events: AgentEvent[] = [];
    faux.onConversationEvent('escape', (e) => events.push(e));
    faux.script([
      { type: 'file_edit', path: '../escaped.txt', content: 'nope' },
      { type: 'complete' },
    ], 'escape');

    await expect(faux.sendPromptAndWait('escape', 'write it')).rejects.toThrow(/outside the conversation's workspace/);
    expect(events.some((e) => e.kind === 'harness.error')).toBe(true);
    await expect(readFile(join(dir, '..', 'escaped.txt'), 'utf8')).rejects.toThrow();
  });

  it('rejects an absolute path outside the workspace', async () => {
    const faux = new FauxProvider();
    await faux.initialize();
    await faux.createConversation({ conversationId: 'escape-abs', workingDirectory: dir });
    faux.script([
      { type: 'file_edit', path: join(tmpdir(), 'faux-absolute-escape.txt'), content: 'nope' },
      { type: 'complete' },
    ], 'escape-abs');

    await expect(faux.sendPromptAndWait('escape-abs', 'write it')).rejects.toThrow(/outside the conversation's workspace/);
    await expect(readFile(join(tmpdir(), 'faux-absolute-escape.txt'), 'utf8')).rejects.toThrow();
  });

  it('still allows a normal write inside the workspace', async () => {
    const faux = new FauxProvider();
    await faux.initialize();
    await faux.createConversation({ conversationId: 'ok', workingDirectory: dir });
    faux.script([
      { type: 'file_edit', path: 'src/inside.ts', content: 'export const ok = true;\n' },
      { type: 'complete' },
    ], 'ok');

    await faux.sendPromptAndWait('ok', 'write it');
    const written = await readFile(join(dir, 'src', 'inside.ts'), 'utf8');
    expect(written).toBe('export const ok = true;\n');
  });
});

describe('FauxProvider — "permission_request" denial (P2-R21b)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'faux-permission-deny-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('skips the following file_edit and reports a failed tool_complete when the permission is denied', async () => {
    const faux = new FauxProvider();
    await faux.initialize();
    const decision: PermissionResponse = { granted: false, reason: 'user said no' };
    await faux.createConversation({
      conversationId: 'deny-1',
      workingDirectory: dir,
      onPermissionRequest: async () => decision,
    });

    const events: AgentEvent[] = [];
    faux.onConversationEvent('deny-1', (e) => events.push(e));
    faux.script([
      { type: 'permission_request', request: { type: 'file_write', description: 'Overwrite config' } },
      { type: 'file_edit', path: 'config.ts', content: 'export const denied = true;\n' },
      { type: 'complete' },
    ], 'deny-1');

    await faux.sendPromptAndWait('deny-1', 'go');

    await expect(readFile(join(dir, 'config.ts'), 'utf8')).rejects.toThrow();
    const complete = events.find(
      (e): e is Extract<AgentEvent, { kind: 'harness.tool_complete' }> => e.kind === 'harness.tool_complete',
    );
    expect(complete?.data.success).toBe(false);
    expect(events.some((e) => e.kind === 'harness.warning')).toBe(true);
  });

  it('does not gate a later, unrelated file_edit', async () => {
    const faux = new FauxProvider();
    await faux.initialize();
    await faux.createConversation({
      conversationId: 'deny-2',
      workingDirectory: dir,
      onPermissionRequest: async () => ({ granted: false }),
    });

    faux.script([
      { type: 'permission_request', request: { type: 'file_write', description: 'Overwrite config' } },
      { type: 'text', content: 'Skipping that edit.' },
      { type: 'file_edit', path: 'unrelated.ts', content: 'export const fine = true;\n' },
      { type: 'complete' },
    ], 'deny-2');

    await faux.sendPromptAndWait('deny-2', 'go');

    const written = await readFile(join(dir, 'unrelated.ts'), 'utf8');
    expect(written).toBe('export const fine = true;\n');
  });

  it('still applies the edit when permission is granted', async () => {
    const faux = new FauxProvider();
    await faux.initialize();
    await faux.createConversation({
      conversationId: 'grant-1',
      workingDirectory: dir,
      onPermissionRequest: async () => ({ granted: true }),
    });

    faux.script([
      { type: 'permission_request', request: { type: 'file_write', description: 'Overwrite config' } },
      { type: 'file_edit', path: 'config.ts', content: 'export const granted = true;\n' },
      { type: 'complete' },
    ], 'grant-1');

    await faux.sendPromptAndWait('grant-1', 'go');
    const written = await readFile(join(dir, 'config.ts'), 'utf8');
    expect(written).toBe('export const granted = true;\n');
  });
});

describe('FauxProvider — "file_edit" line counting (P2-R21c)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'faux-line-count-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('does not over-count additions/deletions for trailing-newline content', async () => {
    await writeFile(join(dir, 'existing.txt'), 'a\nb\n', 'utf8'); // 2 lines

    const faux = new FauxProvider();
    await faux.initialize();
    await faux.createConversation({ conversationId: 'lines-1', workingDirectory: dir });

    const events: AgentEvent[] = [];
    faux.onConversationEvent('lines-1', (e) => events.push(e));
    faux.script([
      { type: 'file_edit', path: 'existing.txt', content: 'a\nb\nc\n' }, // 3 lines
      { type: 'complete' },
    ], 'lines-1');

    await faux.sendPromptAndWait('lines-1', 'edit it');

    const complete = events.find(
      (e): e is Extract<AgentEvent, { kind: 'harness.tool_complete' }> => e.kind === 'harness.tool_complete',
    );
    expect(complete?.data.fileOp?.additions).toBe(3);
    expect(complete?.data.fileOp?.deletions).toBe(2);
  });

  it('counts a file with no trailing newline correctly', async () => {
    const faux = new FauxProvider();
    await faux.initialize();
    await faux.createConversation({ conversationId: 'lines-2', workingDirectory: dir });

    const events: AgentEvent[] = [];
    faux.onConversationEvent('lines-2', (e) => events.push(e));
    faux.script([
      { type: 'file_edit', path: 'new.txt', content: 'a\nb' }, // 2 lines, no trailing newline
      { type: 'complete' },
    ], 'lines-2');

    await faux.sendPromptAndWait('lines-2', 'create it');

    const complete = events.find(
      (e): e is Extract<AgentEvent, { kind: 'harness.tool_complete' }> => e.kind === 'harness.tool_complete',
    );
    expect(complete?.data.fileOp?.additions).toBe(2);
  });
});

describe('FauxProvider — tool_invoke (P2-04, drives registered tools end to end)', () => {
  it('runs the registered tool handler with the scripted input and reports its result', async () => {
    const calls: unknown[] = [];
    const faux = new FauxProvider();
    await faux.initialize();
    await faux.createConversation({
      conversationId: 'inv-1',
      tools: [
        {
          name: 'spawn_background_agent',
          description: 'x',
          parametersSchema: {},
          handler: async (args) => {
            calls.push(args);
            return { ok: true, taskId: 'worker-1' };
          },
        },
      ],
    });
    const events: AgentEvent[] = [];
    faux.onConversationEvent('inv-1', (e) => events.push(e));
    faux.script(
      [
        { type: 'tool_invoke', name: 'spawn_background_agent', input: { taskName: 'audit', objective: 'o' } },
        { type: 'tool_invoke', name: 'missing_tool', input: {} },
        { type: 'complete' },
      ],
      'inv-1',
    );
    await faux.sendPromptAndWait('inv-1', 'go');
    expect(calls).toEqual([{ taskName: 'audit', objective: 'o' }]);
    const completes = events.filter((e) => e.kind === 'harness.tool_complete').map((e) => e.data as Record<string, unknown>);
    expect(completes[0]).toMatchObject({ tool: 'spawn_background_agent', success: true, result: { ok: true, taskId: 'worker-1' } });
    expect(completes[1]).toMatchObject({ tool: 'missing_tool', success: false });
  });
});
