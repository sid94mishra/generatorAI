import { describe, expect, it } from 'vitest';

import {
  formatDuration,
  looksLikeDiff,
  toolKind,
  toolLabel,
  toolSummary,
} from '../components/chat/toolPresentation';

describe('toolKind / toolLabel', () => {
  it('classifies creation before reading', () => {
    // "create_file" contains "file"; a naive read rule would swallow it.
    expect(toolKind('create_file')).toBe('create');
    expect(toolLabel('create_file')).toBe('Create file');
  });

  it('classifies the editor tools agents actually emit', () => {
    expect(toolKind('str_replace_editor')).toBe('edit');
    expect(toolKind('apply_diff')).toBe('edit');
  });

  it('classifies shells', () => {
    expect(toolKind('run_in_terminal')).toBe('shell');
    expect(toolLabel('bash')).toBe('Run command');
  });

  it('humanises an unknown tool rather than showing the raw name', () => {
    expect(toolLabel('frobnicate_widget')).toBe('Frobnicate widget');
    expect(toolKind('frobnicate_widget')).toBe('other');
  });
});

describe('toolSummary', () => {
  it('prefers a path over anything else', () => {
    expect(toolSummary({ filePath: 'src/a.ts', explanation: 'why' })).toBe('src/a.ts');
  });

  it('falls back to a command', () => {
    expect(toolSummary({ command: 'pnpm test' })).toBe('pnpm test');
  });

  it('takes only the first line', () => {
    expect(toolSummary({ command: 'one\ntwo' })).toBe('one');
  });

  it('truncates a very long value', () => {
    const summary = toolSummary({ query: 'x'.repeat(200) });
    expect(summary).toHaveLength(90);
    expect(summary?.endsWith('…')).toBe(true);
  });

  it('returns null rather than dumping JSON for an unrecognised shape', () => {
    expect(toolSummary({ weird: 1 })).toBeNull();
    expect(toolSummary(null)).toBeNull();
    expect(toolSummary(42)).toBeNull();
  });

  it('accepts a bare string', () => {
    expect(toolSummary('  hello  ')).toBe('hello');
  });
});

describe('looksLikeDiff', () => {
  it('accepts a unified diff', () => {
    expect(looksLikeDiff('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b')).toBe(true);
  });

  it('rejects prose that merely mentions a dash', () => {
    expect(looksLikeDiff('- a bullet\n- another')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(looksLikeDiff({ patch: 'x' })).toBe(false);
  });
});

describe('formatDuration', () => {
  it('uses milliseconds below a second', () => {
    expect(formatDuration(340)).toBe('340ms');
  });

  it('uses one decimal of seconds below a minute', () => {
    expect(formatDuration(1400)).toBe('1.4s');
  });

  it('pads the seconds component above a minute', () => {
    expect(formatDuration(125_000)).toBe('2m 05s');
  });

  it('returns null for missing or nonsensical input', () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
    expect(formatDuration(-1)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
  });
});
