// ────────────────────────────────────────────────────────────────
// A command stage's command line as the person types and reads it
// (D-174): `pnpm --filter "@pulse/api" test` ↔ { command, args }.
//
// A command runs ONE program without a shell, so the split is shell-like
// (quotes, backslash escapes) but nothing is expanded: no variables, globs
// or operators. `&&`, `|`, `>` … are reported so the editor can say they
// reach the program as plain arguments.
// ────────────────────────────────────────────────────────────────

export type ParsedCommandLine =
  | { ok: true; command: string; args: string[]; shellOperators: string[] }
  | { ok: false; error: string };

const SHELL_OPERATORS = new Set(['&&', '||', '|', ';', '>', '>>', '<', '&', '2>', '2>&1']);

/** Split a command line into the program and its arguments. */
export function parseCommandLine(line: string): ParsedCommandLine {
  const words: string[] = [];
  let word = '';
  let inWord = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && (line[i + 1] === '"' || line[i + 1] === '\\')) word += line[++i];
      else word += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inWord = true;
    } else if (ch === '\\' && i + 1 < line.length && /[\s"'\\]/.test(line[i + 1]!)) {
      word += line[++i];
      inWord = true;
    } else if (/\s/.test(ch)) {
      if (inWord) words.push(word);
      word = '';
      inWord = false;
    } else {
      word += ch;
      inWord = true;
    }
  }
  if (quote) return { ok: false, error: `A ${quote === '"' ? 'double' : 'single'} quote is not closed` };
  if (inWord) words.push(word);
  const [command, ...args] = words;
  if (!command) return { ok: false, error: 'Type the command to run' };
  return { ok: true, command, args, shellOperators: args.filter((a) => SHELL_OPERATORS.has(a)) };
}

/** One argument as it would be typed: quoted only when it has to be. */
function quoteArg(arg: string): string {
  if (arg !== '' && !/[\s"'\\]/.test(arg)) return arg;
  return `"${arg.replace(/(["\\])/g, '\\$1')}"`;
}

/** The command line of `{ command, args }`; `parseCommandLine` reads it back unchanged. */
export function formatCommandLine(command: string, args: readonly string[] = []): string {
  return [command, ...args].map(quoteArg).join(' ');
}
