import { describe, it, expect } from 'vitest';
import { buildTurnHint, extractSummaryLine, TURN_HINT_MAX_CHARS } from '../turnHint.js';
import { narrowHint, buildCommitPrompt, heuristicCommitMessage } from '../ScmTextGenerator.js';

describe('extractSummaryLine', () => {
  it('finds a plain Summary: line', () => {
    expect(extractSummaryLine('Done.\nSummary: fix the token refresh race')).toBe(
      'fix the token refresh race',
    );
  });

  it('tolerates markdown decoration around the label', () => {
    expect(extractSummaryLine('**Summary:** add a retry ladder')).toBe('add a retry ladder');
    expect(extractSummaryLine('## Summary: add a retry ladder')).toBe('add a retry ladder');
    expect(extractSummaryLine('> Summary: `add a retry ladder`')).toBe('add a retry ladder');
  });

  it('is case-insensitive', () => {
    expect(extractSummaryLine('summary: lower case still counts')).toBe('lower case still counts');
  });

  it('takes the LAST summary line — a revised answer restates it at the end', () => {
    const text = ['Summary: first attempt', 'Actually, on reflection:', 'Summary: what landed'].join(
      '\n',
    );
    expect(extractSummaryLine(text)).toBe('what landed');
  });

  it('ignores an empty or label-only line', () => {
    expect(extractSummaryLine('Summary:')).toBeUndefined();
    expect(extractSummaryLine('Summary:   ')).toBeUndefined();
  });

  it('returns undefined when there is no summary', () => {
    expect(extractSummaryLine('I changed three files.')).toBeUndefined();
    expect(extractSummaryLine('')).toBeUndefined();
    expect(extractSummaryLine(undefined)).toBeUndefined();
  });
});

describe('buildTurnHint', () => {
  it('prefers the agent Summary: line over everything else', () => {
    const hint = buildTurnHint({
      prompt: 'please look at the login flow and do whatever you think is needed',
      assistantText: 'I looked at a lot of files.\n\nSummary: fix the token refresh race',
      chatName: 'Login work',
    });
    expect(hint).toBe('fix the token refresh race');
  });

  it('falls back to the prompt plus the tail of the answer', () => {
    const hint = buildTurnHint({ prompt: 'add retries', assistantText: 'Added a retry ladder.' });
    expect(hint).toContain('Task: add retries');
    expect(hint).toContain('Added a retry ladder.');
  });

  it('falls back to the chat name when the turn said nothing', () => {
    expect(buildTurnHint({ prompt: '  ', assistantText: '', chatName: 'Login work' })).toBe(
      'Login work',
    );
  });

  it('caps the hint and keeps the END of the assistant text', () => {
    const answer = `${'x'.repeat(5_000)}THE-LAST-THING-I-DID`;
    const hint = buildTurnHint({ prompt: 'a'.repeat(5_000), assistantText: answer });
    expect(hint.length).toBeLessThanOrEqual(TURN_HINT_MAX_CHARS);
    expect(hint).toContain('THE-LAST-THING-I-DID');
  });

  it('honours an explicit smaller cap', () => {
    const hint = buildTurnHint({ prompt: 'p'.repeat(200), assistantText: 'a'.repeat(200), max: 40 });
    expect(hint.length).toBeLessThanOrEqual(40);
  });
});

describe('ScmTextGenerator narrows a turn-sized hint', () => {
  it('narrowHint pulls the Summary: line out of a whole-turn hint', () => {
    const raw = 'Task: do the thing\n\nAssistant: blah blah\nSummary: raise the upload limit';
    expect(narrowHint(raw)).toBe('raise the upload limit');
  });

  it('narrowHint passes a plain hint through', () => {
    expect(narrowHint('raise the upload limit')).toBe('raise the upload limit');
    expect(narrowHint('   ')).toBeUndefined();
    expect(narrowHint(undefined)).toBeUndefined();
  });

  it('the commit prompt quotes the summary, not the transcript', () => {
    const prompt = buildCommitPrompt({
      repoDir: '/repo',
      hint: 'Task: whatever\n\nAssistant: rambling\nSummary: raise the upload limit',
      files: ['src/a.ts'],
      diffExcerpt: '',
    });
    expect(prompt).toContain('The author described the task as: raise the upload limit');
    expect(prompt).not.toContain('rambling');
  });

  it('the heuristic subject uses the summary line too', () => {
    const message = heuristicCommitMessage(
      ['src/a.ts'],
      'Task: whatever\n\nAssistant: rambling\nSummary: raise the upload limit',
    );
    expect(message.split('\n')[0]).toBe('raise the upload limit');
  });
});
