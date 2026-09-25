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
