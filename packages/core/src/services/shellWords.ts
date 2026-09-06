// ────────────────────────────────────────────────────────────────
// splitShellWords — POSIX-style word splitting for data-source commands.
//
// The command is executed WITHOUT a shell (`IScriptRunner.run(binary,
// args)`), so anything a shell would interpret — pipes, redirects, `&&`,
// `$VAR` expansion, backticks — cannot work. The old regex tokenizer
// silently mis-parsed those (and escaped quotes) into literal arguments;
// this splitter either produces the exact argv a shell would, or throws
// a message that says what is unsupported and why.
// ────────────────────────────────────────────────────────────────

export class ShellWordsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShellWordsError';
  }
}

const OPERATOR_CHARS = new Set(['|', '&', ';', '<', '>', '(', ')', '`', '\n']);

/**
 * Split `command` into argv. Handles single quotes (literal), double quotes
 * (with `\"`, `\\` escapes) and backslash escapes outside quotes. Throws
 * `ShellWordsError` for unbalanced quotes, shell operators, `$` expansion
 * and unquoted glob characters, all of which would need a shell.
 */
export function splitShellWords(command: string): string[] {
  const words: string[] = [];
  let current = '';
  let hasWord = false;
  let i = 0;
  const n = command.length;

  const flush = (): void => {
    if (hasWord) {
      words.push(current);
      current = '';
      hasWord = false;
    }
  };

  while (i < n) {
    const ch = command[i]!;

    if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      if (end < 0) throw new ShellWordsError('Unbalanced single quote in command');
      current += command.slice(i + 1, end);
      hasWord = true;
      i = end + 1;
      continue;
    }

    if (ch === '"') {
      i++;
      let closed = false;
      while (i < n) {
        const c = command[i]!;
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        if (c === '\\' && i + 1 < n && ['"', '\\', '$', '`'].includes(command[i + 1]!)) {
          current += command[i + 1]!;
          i += 2;
          continue;
        }
        if (c === '$' || c === '`') {
          throw new ShellWordsError(
            `Shell expansion ("${c}") is not supported — the data-source command runs without a shell. Pass values via the env field or quote them literally with single quotes.`,
          );
        }
        current += c;
        i++;
      }
      if (!closed) throw new ShellWordsError('Unbalanced double quote in command');
      hasWord = true;
      continue;
    }

    if (ch === '\\') {
      if (i + 1 >= n) throw new ShellWordsError('Trailing backslash in command');
      current += command[i + 1]!;
      hasWord = true;
      i += 2;
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      flush();
      i++;
      continue;
    }

    if (OPERATOR_CHARS.has(ch)) {
      const op = ch === '\n' ? 'newline' : ch;
      throw new ShellWordsError(
        `Shell operators are not supported (found "${op}") — the data-source command runs without a shell. Put the pipeline in a script file and run that instead.`,
      );
    }

    if (ch === '$') {
      throw new ShellWordsError(
        'Shell variable expansion ("$") is not supported — the data-source command runs without a shell. Pass values via the env field instead.',
      );
    }

    if (ch === '*' || ch === '?' || ch === '[' || ch === '~') {
      throw new ShellWordsError(
        `Unquoted "${ch}" would be expanded by a shell but this command runs without one; quote it if it is literal.`,
      );
    }

    current += ch;
    hasWord = true;
    i++;
  }
  flush();

  if (words.length === 0) throw new ShellWordsError('Command is empty');
  return words;
}
