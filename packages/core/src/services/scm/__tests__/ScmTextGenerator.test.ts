import { describe, it, expect, vi } from 'vitest';
import type { IAgentHarness } from '../../../domain/ports/IAgentHarness.js';
import {
  ScmTextGenerator,
  buildCommitPrompt,
  buildPullRequestPrompt,
  capDiffExcerpt,
  heuristicCommitMessage,
  heuristicPullRequestText,
  parseCommitReply,
  parsePullRequestReply,
} from '../ScmTextGenerator.js';
import { silentLogger } from './helpers.js';

function fakeHarness(overrides: Partial<Record<string, unknown>> = {}) {
  const api = {
    createConversation: vi.fn(async () => 'conv'),
    sendPromptAndWait: vi.fn(async () => ({ content: 'fix(scm): do the thing' })),
    deleteConversation: vi.fn(async () => {}),
    ...overrides,
  };
  return { api, harness: api as unknown as IAgentHarness };
}

describe('capDiffExcerpt', () => {
  const fileDiff = (name: string, body: string) =>
    `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n${body}`;

  it('returns the diff unchanged when it already fits', () => {
    const diff = fileDiff('a.ts', '+one\n');
    expect(capDiffExcerpt(diff, 5000)).toBe(diff);
  });

  it('never exceeds the cap', () => {
    const diff = [
      fileDiff('a.ts', '+a\n'.repeat(4000)),
      fileDiff('b.ts', '+b\n'.repeat(4000)),
      fileDiff('c.ts', '+c\n'.repeat(4000)),
    ].join('\n');
    const capped = capDiffExcerpt(diff, 3000);
    expect(capped.length).toBeLessThanOrEqual(3000);
  });

  it('trims per file so every file keeps its header', () => {
    const diff = [
      fileDiff('a.ts', '+a\n'.repeat(3000)),
      fileDiff('b.ts', '+b\n'.repeat(2)),
      fileDiff('c.ts', '+c\n'.repeat(2)),
    ].join('\n');
    const capped = capDiffExcerpt(diff, 4000);
    expect(capped).toContain('diff --git a/a.ts b/a.ts');
    expect(capped).toContain('diff --git a/b.ts b/b.ts');
    expect(capped).toContain('diff --git a/c.ts b/c.ts');
    expect(capped).toContain('… (truncated)');
    // The huge file did not crowd the others out.
    expect(capped.length).toBeLessThanOrEqual(4000);
  });

  it('reports the files it could not fit at all', () => {
    const diff = Array.from({ length: 40 }, (_, i) => fileDiff(`f${i}.ts`, '+x\n'.repeat(200))).join(
      '\n',
    );
    const capped = capDiffExcerpt(diff, 2000);
    expect(capped).toMatch(/… \(\d+ more files omitted\)$/);
    expect(capped.length).toBeLessThanOrEqual(2000);
  });

  it('handles an empty diff', () => {
    expect(capDiffExcerpt('', 100)).toBe('');
  });
});

describe('buildCommitPrompt', () => {
  it('includes the hint, the file list and the diff', () => {
    const prompt = buildCommitPrompt({
      repoDir: '/repo',
      hint: 'Fix the flaky login test',
      files: ['src/a.ts', 'src/b.ts'],
      diffExcerpt: 'diff --git a/src/a.ts b/src/a.ts',
    });
    expect(prompt).toContain('The author described the task as: Fix the flaky login test');
    expect(prompt).toContain('- src/a.ts');
    expect(prompt).toContain('- src/b.ts');
    expect(prompt).toContain('diff --git a/src/a.ts');
    expect(prompt).toContain('Conventional Commits');
    expect(prompt).toContain('at most 50 characters');
    expect(prompt).toContain('Do not invent testing that was not performed.');
    expect(prompt.trimEnd()).toMatch(
      /Reply with the commit message only — no code fences, no preamble\.$/,
    );
  });

  it('omits the hint line when there is no hint', () => {
    const prompt = buildCommitPrompt({
      repoDir: '/repo',
      files: ['a.ts'],
      diffExcerpt: '',
    });
    expect(prompt).not.toContain('The author described the task as');
  });
});

describe('buildPullRequestPrompt', () => {
  const base = {
    repoDir: '/repo',
    base: 'main',
    commits: ['feat: add a thing'],
    files: ['src/a.ts'],
    diffExcerpt: 'diff --git a/src/a.ts b/src/a.ts',
  };

  it('asks for Summary / Test plan when there is no template', () => {
    const prompt = buildPullRequestPrompt(base);
    expect(prompt).toContain('`main`');
    expect(prompt).toContain('- feat: add a thing');
    expect(prompt).toContain('## Summary');
    expect(prompt).toContain('## Test plan');
    expect(prompt).toContain('TITLE: <one-line PR title, imperative, no trailing period>');
    expect(prompt).toContain('Do not invent testing that was not performed');
    expect(prompt).toContain('- Not verified');
  });

  it('asks the model to fill the repo template verbatim when one is present', () => {
    const prompt = buildPullRequestPrompt({ ...base, template: '## What\n<!-- why -->\n## How' });
    expect(prompt).toContain('keep every heading exactly as written');
    expect(prompt).toContain('## What');
    expect(prompt).toContain('## How');
    expect(prompt).not.toContain('Structure the description as a `## Summary` section');
  });
});

describe('parseCommitReply', () => {
  it('trims whitespace', () => {
    expect(parseCommitReply('  fix: thing\n\n- why\n  ')).toBe('fix: thing\n\n- why');
  });

  it('strips a wrapping code fence', () => {
    expect(parseCommitReply('```text\nfix: thing\n\n- why\n```')).toBe('fix: thing\n\n- why');
  });

  it('drops a leading label line', () => {
    expect(parseCommitReply('Commit message:\nfix: thing')).toBe('fix: thing');
    expect(parseCommitReply('**Commit message:** fix: thing')).toBe('fix: thing');
  });
});

describe('parsePullRequestReply', () => {
  it('parses the TITLE: form', () => {
    const parsed = parsePullRequestReply('TITLE: Add a thing\n\n## Summary\n\n- did it');
    expect(parsed).toEqual({ title: 'Add a thing', body: '## Summary\n\n- did it' });
  });

  it('parses a bold **TITLE:** form, case-insensitively', () => {
    expect(parsePullRequestReply('**title:** Add a thing\n\nbody')?.title).toBe('Add a thing');
  });

  it('parses the JSON form', () => {
    expect(parsePullRequestReply('{"title":"Add a thing","body":"## Summary"}')).toEqual({
      title: 'Add a thing',
      body: '## Summary',
    });
  });

  it('parses a fenced JSON form', () => {
    expect(
      parsePullRequestReply('```json\n{"title":"Add a thing","body":"b"}\n```')?.title,
    ).toBe('Add a thing');
  });

  it('returns null when neither form is present', () => {
    expect(parsePullRequestReply('I could not do that.')).toBeNull();
    expect(parsePullRequestReply('')).toBeNull();
  });
});

describe('heuristic text', () => {
  it('summarises files by top directory, plural-correct', () => {
    expect(heuristicCommitMessage(['src/core/a.ts', 'src/core/b.ts'])).toContain(
      'Update 2 files in src/core',
    );
    expect(heuristicCommitMessage(['README.md'])).toContain('Update 1 file in the repo root');
  });

  it('lists the files and caps the list', () => {
    const files = Array.from({ length: 25 }, (_, i) => `src/f${i}.ts`);
    const message = heuristicCommitMessage(files);
    expect(message).toContain('- src/f0.ts');
    expect(message).toContain('- … and 5 more');
  });

  it('prefers the hint as the subject, truncated to 72 chars', () => {
    const long = 'x'.repeat(200);
    const subject = heuristicCommitMessage(['a.ts'], long).split('\n')[0]!;
    expect(subject.length).toBeLessThanOrEqual(72);
  });

  it('builds a Summary / Test plan PR body with Not verified', () => {
    const pr = heuristicPullRequestText(['src/a.ts'], ['feat: x'], 'Do the thing');
    expect(pr.title).toBe('Do the thing');
    expect(pr.body).toContain('## Summary');
    expect(pr.body).toContain('- Do the thing');
    expect(pr.body).toContain('## Test plan');
    expect(pr.body).toContain('- Not verified');
  });
});

describe('ScmTextGenerator', () => {
  const input = { repoDir: '/repo', files: ['src/a.ts'], diffExcerpt: 'diff' };

  it('never touches the harness when no model is configured', async () => {
    const { api, harness } = fakeHarness();
    const gen = new ScmTextGenerator({
      harness,
      logger: silentLogger,
      generation: () => ({ provider: null, model: null }),
    });
    const result = await gen.generateCommitMessage(input);
    expect(result.source).toBe('heuristic');
    expect(api.createConversation).not.toHaveBeenCalled();
    expect(api.sendPromptAndWait).not.toHaveBeenCalled();
  });

  it('writes with the chat\'s own model when Settings names none', async () => {
    // "Generate" in a chat that is already talking to a model answered with
    // the chat's NAME and a list of file paths, because no generation model
    // had been picked in Settings → Source Control.
    const { api, harness } = fakeHarness();
    const gen = new ScmTextGenerator({
      harness,
      logger: silentLogger,
      generation: () => ({ provider: null, model: null }),
    });
    const result = await gen.generateCommitMessage({
      ...input,
      fallbackGeneration: { provider: 'claude-agent', model: 'opus[1m]' },
    });
    expect(result).toMatchObject({ source: 'model', model: 'opus[1m]' });
    const params = (api.createConversation.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >)[0]![0];
    expect(params['model']).toBe('opus[1m]');
    expect(params['harnessType']).toBe('claude-agent');
  });

  it('prefers the configured model over the chat\'s', async () => {
    const { api, harness } = fakeHarness();
    const gen = new ScmTextGenerator({
      harness,
      logger: silentLogger,
      generation: () => ({ provider: 'claude-agent', model: 'haiku' }),
    });
    const result = await gen.generateCommitMessage({
      ...input,
      fallbackGeneration: { provider: 'codex', model: 'gpt-5.6-sol' },
    });
    expect(result.model).toBe('haiku');
    const params = (api.createConversation.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >)[0]![0];
    expect(params['harnessType']).toBe('claude-agent');
  });

  it('uses the model reply and deletes the ephemeral conversation', async () => {
    const { api, harness } = fakeHarness();
    const gen = new ScmTextGenerator({
      harness,
      logger: silentLogger,
      generation: () => ({ provider: 'claude-agent', model: 'sonnet' }),
    });
    const result = await gen.generateCommitMessage(input);
    expect(result).toEqual({
      message: 'fix(scm): do the thing',
      model: 'sonnet',
      source: 'model',
    });
    expect(api.createConversation).toHaveBeenCalledTimes(1);
    const params = (api.createConversation.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >)[0]![0];
    expect(params['maxTurns']).toBe(1);
    expect(params['permissionMode']).toBe('plan');
    expect(params['excludedTools']).toEqual(['*']);
    expect(params['availableTools']).toEqual([]);
    expect(params['workingDirectory']).toBe('/repo');
    expect(api.deleteConversation).toHaveBeenCalledWith(params['conversationId']);
  });

  it('deletes the conversation even when the prompt throws, and falls back', async () => {
    const { api, harness } = fakeHarness({
      sendPromptAndWait: vi.fn(async () => {
        throw new Error('model exploded');
      }),
    });
    const gen = new ScmTextGenerator({
      harness,
      logger: silentLogger,
      generation: () => ({ provider: null, model: 'sonnet' }),
    });
    const result = await gen.generateCommitMessage(input);
    expect(result.source).toBe('heuristic');
    expect(result.message).toContain('Update 1 file');
    expect(api.deleteConversation).toHaveBeenCalledTimes(1);
  });

  it('deletes the conversation even when creation throws', async () => {
    const { api, harness } = fakeHarness({
      createConversation: vi.fn(async () => {
        throw new Error('no capacity');
      }),
    });
    const gen = new ScmTextGenerator({
      harness,
      logger: silentLogger,
      generation: () => ({ provider: null, model: 'sonnet' }),
    });
    expect((await gen.generateCommitMessage(input)).source).toBe('heuristic');
    expect(api.deleteConversation).toHaveBeenCalledTimes(1);
  });

  it('falls back to heuristic PR text when the reply cannot be parsed', async () => {
    const { harness } = fakeHarness({
      sendPromptAndWait: vi.fn(async () => ({ content: 'sorry, no' })),
    });
    const gen = new ScmTextGenerator({
      harness,
      logger: silentLogger,
      generation: () => ({ provider: null, model: 'sonnet' }),
    });
    const result = await gen.generatePullRequestText({
      repoDir: '/repo',
      base: 'main',
      commits: [],
      files: ['src/a.ts'],
      diffExcerpt: '',
    });
    expect(result.source).toBe('heuristic');
    expect(result.body).toContain('- Not verified');
  });

  it('uses a parsed model PR reply', async () => {
    const { harness } = fakeHarness({
      sendPromptAndWait: vi.fn(async () => ({ content: 'TITLE: Add a thing\n\n## Summary\n\n- x' })),
    });
    const gen = new ScmTextGenerator({
      harness,
      logger: silentLogger,
      generation: () => ({ provider: null, model: 'sonnet' }),
    });
    const result = await gen.generatePullRequestText({
      repoDir: '/repo',
      base: 'main',
      commits: [],
      files: [],
      diffExcerpt: '',
    });
    expect(result).toEqual({
      title: 'Add a thing',
      body: '## Summary\n\n- x',
      model: 'sonnet',
      source: 'model',
    });
  });
});
