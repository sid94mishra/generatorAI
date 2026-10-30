import { describe, expect, it } from 'vitest';
import { formatCommandLine, parseCommandLine } from '../src/commandLine.js';

describe('parseCommandLine', () => {
  it('splits a typed command line, honouring quotes and escapes', () => {
    expect(parseCommandLine('  pnpm --filter "@pulse/api" test  ')).toEqual({ ok: true, command: 'pnpm', args: ['--filter', '@pulse/api', 'test'], shellOperators: [] });
    expect(parseCommandLine(`node -e 'console.log(1 + 1)'`)).toMatchObject({ command: 'node', args: ['-e', 'console.log(1 + 1)'] });
    expect(parseCommandLine('echo "say \\"hi\\"" a\\ b ""')).toMatchObject({ args: ['say "hi"', 'a b', ''] });
  });

  it('reports shell operators: there is no shell, they reach the program as arguments', () => {
    expect(parseCommandLine('pnpm lint && pnpm test')).toMatchObject({ ok: true, shellOperators: ['&&'] });
  });

  it('refuses an empty line and an unclosed quote', () => {
    expect(parseCommandLine('   ')).toEqual({ ok: false, error: 'Type the command to run' });
    expect(parseCommandLine('echo "oops')).toEqual({ ok: false, error: 'A double quote is not closed' });
  });
});

describe('formatCommandLine', () => {
  it('quotes only what needs it, and parses back to the same command', () => {
    const args = ['--filter', '@pulse/api', 'a b', 'say "hi"', '', 'back\\slash'];
    const line = formatCommandLine('pnpm', args);
    expect(line).toBe('pnpm --filter @pulse/api "a b" "say \\"hi\\"" "" "back\\\\slash"');
    expect(parseCommandLine(line)).toMatchObject({ ok: true, command: 'pnpm', args });
  });
});
