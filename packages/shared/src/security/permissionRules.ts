// ────────────────────────────────────────────────────────────────
// Permission rules (U-16, D-147) — client-safe, pure.
//
// "Allow for this chat / for this run" on a tool-permission gate remembers
// the gate as RULES, scoped to its owner (a chat for its lifetime, a workflow
// run for all of its stages). Before a later gate of the same owner parks,
// the server checks the owner's rules and allows a request every one of
// whose parts a rule covers, without asking again.
//
//   shell   one rule per command in the line: the program, plus the first
//           subcommand for multi-command tools (`pnpm lint`, `git status`,
//           `ls`, `cat`). The line is split quote-aware on `;` `|` `&&` `||`
//           `&` and newlines; `2>&1` / `&>` are redirects; `$(…)`, backticks
//           and `<(…)` are commands of their own. A request is covered when
//           EVERY command in it is.
//   other   the tool's name (`Edit`, `github_comment_issue`, an MCP tool).
//
// Never remembered, never auto-allowed: a risky gate (the MG-04 verdict,
// recomputed here on the FULL command so a display summary cut at its length
// cap cannot hide the risky part), a tool that always asks a person (merging
// a pull request, computer use), and commands on the never-list below (sudo,
// shells and evaluators, `rm` of an absolute or climbing path, `git push`,
// ssh, osascript, security, launchctl, `chmod -R`, dd, mkfs …). Rules are
// derived deterministically, so "covered" is simply: the request derives a
// non-empty rule set and each of its rules is stored.
// ────────────────────────────────────────────────────────────────

import type { ToolPermissionType } from '../types/AgentMode.js';
import { classifyPermissionRisk } from './gateRisk.js';

/** One remembered permission: a command (`pnpm lint`) or a tool (`github_comment_issue`). */
export interface PermissionRule {
  kind: 'command' | 'tool';
  /** `pnpm lint`, `git status`, `ls` — or the tool name. */
  match: string;
  /** On a remembered / covering rule: it belongs to the project ("Allow in this project"), not the chat or run. */
  scope?: 'project';
}

/** What the rule module needs to know about a gate. */
export interface PermissionSubject {
  type: ToolPermissionType;
  toolName: string;
  /** The FULL, untruncated command line of a `shell_exec` gate. Without it a shell gate is never remembered. */
  command?: string | undefined;
  /** The tool input rendered as text (file paths, …), for the risk verdict of non-shell gates. */
  inputSummary?: string | undefined;
  /** The tool asks a person every time (D-146 `github_merge_pull_request`). */
  alwaysAsk?: boolean | undefined;
}

export interface RememberablePermission {
  /** The rules "Allow for this chat/run" adds; empty when the gate cannot be remembered. */
  rules: PermissionRule[];
  /** Why it cannot be remembered (shown on the card); absent when `rules` is non-empty. */
  refusal?: string;
}

/** Tools that always ask a person, whatever is remembered (D-146; computer use asks through its own consent). */
const ALWAYS_ASK_TOOLS: ReadonlySet<string> = new Set(['github_merge_pull_request']);

/** Programs whose rules cover any command they run, or that are on the never-list. */
const NEVER_PROGRAMS: ReadonlyMap<string, string> = new Map([
  ...['sudo', 'doas', 'su', 'pkexec', 'runas'].map((p) => [p, 'Commands run with elevated rights always ask.'] as const),
  ...['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'pwsh', 'powershell', 'powershell.exe', 'pwsh.exe', 'cmd', 'cmd.exe'].map(
    (p) => [p, 'Commands that start a shell always ask.'] as const,
  ),
  ...['eval', 'exec', 'source', '.', 'xargs', 'env', 'nohup', 'timeout', 'watch', 'nice', 'chroot', 'command', 'builtin'].map(
    (p) => [p, 'Commands that run another command always ask.'] as const,
  ),
  ...['ssh', 'scp', 'sftp', 'telnet'].map((p) => [p, 'Remote shells always ask.'] as const),
  ['osascript', 'Scripting other apps always asks.'],
  ['security', 'Keychain access always asks.'],
  ['launchctl', 'Changing system services always asks.'],
  ['crontab', 'Scheduling commands always asks.'],
  ['dd', 'Raw disk writes always ask.'],
  ['mkfs', 'Formatting a disk always asks.'],
  ['diskutil', 'Disk changes always ask.'],
]);

/** Shell keywords: a line with control flow is not a flat list of commands. */
const CONTROL_FLOW: ReadonlySet<string> = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'select', 'function', 'coproc',
]);

/** Environment variables that change what a command runs. */
const DANGEROUS_ENV = /^(PATH|IFS|BASH_ENV|ENV|PROMPT_COMMAND|NODE_OPTIONS|PYTHONSTARTUP|PYTHONPATH|PERL5OPT|RUBYOPT|GIT_SSH_COMMAND|GIT_SSH|GIT_EXEC_PATH|GIT_CONFIG\w*|LD_\w+|DYLD_\w+)=/;

/** Multi-command tools: the rule carries the first subcommand. Values: the flags that take a separate value. */
const MULTI_COMMAND: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries({
    git: ['-C', '--git-dir', '--work-tree', '--namespace'],
    pnpm: ['--filter', '-F', '-C', '--dir', '--workspace-dir', '--reporter', '--loglevel'],
    npm: ['--prefix', '-w', '--workspace', '--loglevel'],
    yarn: ['--cwd'],
    bun: ['--cwd'],
    deno: [],
    npx: ['-p', '--package'],
    docker: ['-H', '--host', '--context', '-c', '--config', '-l', '--log-level'],
    cargo: ['-C', '--config', '-Z'],
    go: ['-C'],
    make: ['-C', '-f', '--file', '--directory', '-I', '--include-dir', '-o', '-W'],
    kubectl: ['-n', '--namespace', '--context', '--cluster', '-s', '--server', '--kubeconfig', '--user'],
    gh: ['-R', '--repo'],
    uv: ['--directory', '--project'],
    pip: [],
    pip3: [],
    poetry: ['-C', '--directory'],
    dotnet: [],
    brew: [],
    turbo: [],
    nx: [],
  }).map(([k, v]) => [k, new Set(v)]),
);

/** `<tool> <sub>` whose next word is what actually runs: the rule carries it too (`pnpm exec vitest`). */
const RUNS_NEXT: ReadonlySet<string> = new Set([
  'pnpm run', 'pnpm exec', 'pnpm dlx', 'npm run', 'npm run-script', 'npm exec', 'yarn run', 'yarn exec', 'yarn dlx',
  'bun run', 'bun x', 'uv run', 'uv tool', 'poetry run', 'deno run', 'deno task', 'dotnet run',
]);

/** `<tool> <group> <verb>`: the group alone would allow every verb in it (`gh pr view`, not `gh pr` → `gh pr merge`). */
const TWO_LEVEL: ReadonlySet<string> = new Set(['gh', 'kubectl']);

/** Subcommands that run anything (a container, a remote API call): never remembered. */
const NEVER_SUBCOMMANDS: ReadonlyMap<string, string> = new Map([
  ['git push', 'Pushing to a git remote always asks.'],
  ['gh api', 'Raw GitHub API calls always ask.'],
  ['docker run', 'Running a container always asks.'],
  ['docker exec', 'Running a command in a container always asks.'],
  ['kubectl exec', 'Running a command in a pod always asks.'],
]);

/** Interpreters: the rule names the script (`node scripts/build.mjs`); inline code is never remembered. */
const INTERPRETERS: ReadonlySet<string> = new Set(['node', 'python', 'python3', 'ruby', 'perl', 'php', 'tsx', 'ts-node']);
const INLINE_CODE_FLAGS: ReadonlySet<string> = new Set(['-e', '--eval', '-p', '--print', '-c', '-E', '-r', '--require', '-i', '--import']);

// ── Shell line → commands ───────────────────────────────────────

interface Word {
  text: string;
  /** Carries an expansion (`$VAR`, `$(…)`, a backtick) — its value is only known at run time. */
  dynamic: boolean;
}

class ShellLineParser {
  private i = 0;
  readonly commands: Word[][] = [];
  problem: string | undefined;
  /** An output redirect (`>`, `>>`, `&>`, `>|`, `<>`, `>(…)`) to anything but /dev/null: the line writes a file. */
  writesFile = false;

  constructor(private readonly s: string) {}

  parse(): this {
    this.list(false);
    return this;
  }

  /** Parse a command list until the end, or until the `)` that closes a subshell / substitution. */
  private list(nested: boolean): void {
    const s = this.s;
    let words: Word[] = [];
    let cur = '';
    let inWord = false;
    let dynamic = false;
    let redirectTarget = false;
    let redirectOut = false;

    const endWord = (): void => {
      if (inWord) {
        if (redirectTarget) {
          if (redirectOut && (dynamic || cur !== '/dev/null')) this.writesFile = true;
          redirectTarget = false;
          redirectOut = false;
        } else words.push({ text: cur, dynamic });
      }
      cur = '';
      inWord = false;
      dynamic = false;
    };
    const endCommand = (): void => {
      endWord();
      if (redirectTarget) this.problem ??= 'a redirect has no target';
      redirectTarget = false;
      if (words.length > 0) this.commands.push(words);
      words = [];
    };

    while (this.i < s.length && !this.problem) {
      const c = s[this.i]!;
      const next = s[this.i + 1];
      if (c === '\\') {
        if (next !== '\n') {
          cur += next ?? '';
          inWord = true;
        }
        this.i += 2;
        continue;
      }
      if (c === "'") {
        const end = s.indexOf("'", this.i + 1);
        if (end < 0) {
          this.problem = 'a quote is not closed';
          return;
        }
        cur += s.slice(this.i + 1, end);
        inWord = true;
        this.i = end + 1;
        continue;
      }
      if (c === '"') {
        this.i += 1;
        inWord = true;
        let closed = false;
        while (this.i < s.length && !this.problem) {
          const d = s[this.i]!;
          if (d === '"') {
            closed = true;
            this.i += 1;
            break;
          }
          if (d === '\\' && this.i + 1 < s.length && '"\\$`\n'.includes(s[this.i + 1]!)) {
            if (s[this.i + 1] !== '\n') cur += s[this.i + 1];
            this.i += 2;
            continue;
          }
          if (d === '$' && s[this.i + 1] === '(') {
            this.substitution();
            dynamic = true;
            continue;
          }
          if (d === '`') {
            this.backtick();
            dynamic = true;
            continue;
          }
          if (d === '$') dynamic = true;
          cur += d;
          this.i += 1;
        }
        if (!closed) this.problem ??= 'a quote is not closed';
        continue;
      }
      if (c === '$' && next === '(') {
        this.substitution();
        dynamic = true;
        inWord = true;
        continue;
      }
      if (c === '`') {
        this.backtick();
        dynamic = true;
        inWord = true;
        continue;
      }
      if (c === '$') {
        dynamic = true;
        cur += c;
        inWord = true;
        this.i += 1;
        continue;
      }
      if ((c === '<' || c === '>') && next === '(') {
        // Process substitution: a command of its own, used as a file name.
        if (c === '>') this.writesFile = true;
        endWord();
        this.i += 2;
        this.list(true);
        continue;
      }
      if (c === '#' && !inWord) {
        while (this.i < s.length && s[this.i] !== '\n') this.i += 1;
        continue;
      }
      if (c === ' ' || c === '\t' || c === '\r') {
        endWord();
        this.i += 1;
        continue;
      }
      if (c === '\n' || c === ';') {
        endCommand();
        this.i += 1;
        continue;
      }
      if (c === '|') {
        endCommand();
        this.i += next === '|' || next === '&' ? 2 : 1;
        continue;
      }
      if (c === '&') {
        if (next === '&') {
          endCommand();
          this.i += 2;
          continue;
        }
        if (next === '>') {
          // `&>` / `&>>`: stdout and stderr to a file — a redirect, not a separator.
          endWord();
          this.i += s[this.i + 2] === '>' ? 3 : 2;
          redirectTarget = true;
          redirectOut = true;
          continue;
        }
        endCommand(); // `cmd &` — background, then the next command.
        this.i += 1;
        continue;
      }
      if (c === '>' || c === '<') {
        // A file-descriptor prefix (`2>`) belongs to the redirect, not to the words.
        if (inWord && !dynamic && /^\d+$/.test(cur)) {
          cur = '';
          inWord = false;
        } else {
          endWord();
        }
        if (c === '<' && next === '<') {
          if (s[this.i + 2] === '<') {
            this.i += 3; // here-string `<<< word`
            redirectTarget = true;
            continue;
          }
          this.problem = 'it has a here-document';
          return;
        }
        this.i += 1;
        const op = s[this.i];
        if (op === '&') {
          // `>&2`, `2>&1`, `<&-`: duplicate a descriptor; `>& file` writes a file.
          this.i += 1;
          const fd = /^(?:\d+|-)/.exec(s.slice(this.i));
          if (fd) {
            this.i += fd[0].length;
            continue;
          }
        } else if (op === '>' || op === '|' || (c === '<' && op === '>')) {
          this.i += 1;
        }
        redirectTarget = true;
        redirectOut = c === '>' || op === '>';
        continue;
      }
      if (c === '(' && !inWord) {
        if (words.length > 0) {
          this.problem = 'it defines a function';
          return;
        }
        this.i += 1;
        this.list(true); // a subshell's commands
        continue;
      }
      if (c === ')') {
        if (nested) {
          endCommand();
          this.i += 1;
          return;
        }
        this.problem = 'its parentheses do not match';
        return;
      }
      cur += c;
      inWord = true;
      this.i += 1;
    }
    endCommand();
    if (nested) this.problem ??= 'its parentheses do not match';
  }

  /** `$( … )` at `this.i`; arithmetic `$(( … ))` is skipped as a value. */
  private substitution(): void {
    if (this.s[this.i + 2] === '(') {
      const end = this.s.indexOf('))', this.i + 3);
      if (end < 0) {
        this.problem = 'its parentheses do not match';
        return;
      }
      this.i = end + 2;
      return;
    }
    this.i += 2;
    this.list(true);
  }

  /** A backtick substitution at `this.i`: its text is a command line of its own. */
  private backtick(): void {
    let j = this.i + 1;
    let inner = '';
    while (j < this.s.length && this.s[j] !== '`') {
      if (this.s[j] === '\\' && j + 1 < this.s.length) {
        inner += this.s[j + 1];
        j += 2;
        continue;
      }
      inner += this.s[j];
      j += 1;
    }
    if (j >= this.s.length) {
      this.problem = 'a backtick is not closed';
      return;
    }
    this.i = j + 1;
    const sub = new ShellLineParser(inner).parse();
    if (sub.problem) this.problem = sub.problem;
    this.commands.push(...sub.commands);
  }
}

/** A path argument that leaves the working directory: absolute, home-relative, a drive, or climbing with `..`. */
function leavesWorkspace(arg: string): boolean {
  return /^(?:\/|~|[A-Za-z]:[\\/]|\\\\)/.test(arg) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(arg);
}

type CommandVerdict = { rule: string } | { refusal: string } | { none: true };

/** The rule one command of the line yields, or why it never may. */
function commandRule(input: readonly Word[]): CommandVerdict {
  let words = input.filter((w) => w.dynamic || !['{', '}', '!'].includes(w.text));
  // Leading assignments (`CI=1 pnpm test`) set the environment of the command.
  while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!.text)) {
    if (DANGEROUS_ENV.test(words[0]!.text)) return { refusal: 'Commands that change what runs (PATH, LD_PRELOAD …) always ask.' };
    words = words.slice(1);
  }
  if (words.length === 0) return { none: true };
  const head = words[0]!;
  if (head.dynamic || /[*?[\]]/.test(head.text) || head.text === '') {
    return { refusal: 'Commands whose name is only known when they run always ask.' };
  }
  const program = head.text;
  if (CONTROL_FLOW.has(program)) return { refusal: 'Command lines with shell control flow (if, for, while) always ask.' };
  const base = program.replace(/^.*[\\/]/, '');
  const never = NEVER_PROGRAMS.get(program) ?? NEVER_PROGRAMS.get(base) ?? (/^mkfs\./.test(base) ? NEVER_PROGRAMS.get('mkfs') : undefined);
  if (never) return { refusal: never };
  const args = words.slice(1);
  // `set -e`, `set -o pipefail`: shell options of this line, not a command worth remembering ("Allow set +4", U-72).
  if (program === 'set' && args.every((a) => !a.dynamic && (/^[-+]/.test(a.text) || a.text === 'pipefail'))) return { none: true };

  if (base === 'rm' || base === 'rmdir') {
    if (args.some((a) => a.dynamic || leavesWorkspace(a.text))) return { refusal: 'Deleting outside the workspace always asks.' };
  }
  if (base === 'chmod' || base === 'chown') {
    if (args.some((a) => !a.dynamic && /^-[a-zA-Z]*R/.test(a.text))) return { refusal: 'Recursive permission changes always ask.' };
  }
  if (base === 'find' && args.some((a) => /^-(?:exec|execdir|ok|okdir|delete)$/.test(a.text))) {
    return { refusal: 'find with -exec or -delete always asks.' };
  }

  if (INTERPRETERS.has(base)) {
    const rest: string[] = [];
    for (let k = 0; k < args.length; k += 1) {
      const a = args[k]!;
      if (a.dynamic) return { refusal: 'Commands whose script is only known when they run always ask.' };
      if (INLINE_CODE_FLAGS.has(a.text) || /^--(?:eval|print|require|import)=/.test(a.text)) {
        return { refusal: 'Inline code always asks.' };
      }
      if (a.text === '-m' && (base === 'python' || base === 'python3')) {
        const mod = args[k + 1];
        if (!mod || mod.dynamic) return { refusal: 'Commands whose script is only known when they run always ask.' };
        rest.push('-m', mod.text);
        break;
      }
      if (a.text.startsWith('-')) continue;
      rest.push(a.text);
      break;
    }
    if (rest.length === 0) return { refusal: 'An interpreter reading code from its input always asks.' };
    return { rule: [program, ...rest].join(' ') };
  }

  const valueFlags = MULTI_COMMAND.get(base);
  if (!valueFlags) return { rule: program };

  if (base === 'git' && args.some((a) => /^(?:-c|--config-env|--exec-path)(?:=|$)/.test(a.text))) {
    return { refusal: 'git with inline configuration always asks.' };
  }
  const subs: string[] = [];
  let needed = 1;
  for (let k = 0; k < args.length && subs.length < needed; k += 1) {
    const a = args[k]!;
    if (a.dynamic) return { refusal: 'Commands whose subcommand is only known when they run always ask.' };
    if (a.text.startsWith('-')) {
      if (valueFlags.has(a.text)) k += 1; // its value
      continue;
    }
    if (base === 'make' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(a.text)) continue;
    if (subs.length === 0) needed = TWO_LEVEL.has(base) || RUNS_NEXT.has(`${base} ${a.text}`) ? 2 : 1;
    subs.push(a.text);
  }
  const neverSub = subs.length > 0 ? NEVER_SUBCOMMANDS.get(`${base} ${subs[0]}`) : undefined;
  if (neverSub) return { refusal: neverSub };
  return { rule: [program, ...subs].join(' ') };
}

/** The commands of a shell line as rules, or why it can never be remembered. */
export function shellCommandRules(command: string): RememberablePermission {
  const parsed = new ShellLineParser(command).parse();
  if (parsed.problem) return { rules: [], refusal: `This command always asks: ${parsed.problem}.` };
  const seen = new Set<string>();
  const rules: PermissionRule[] = [];
  for (const words of parsed.commands) {
    const verdict = commandRule(words);
    if ('refusal' in verdict) return { rules: [], refusal: verdict.refusal };
    if ('none' in verdict || seen.has(verdict.rule)) continue;
    seen.add(verdict.rule);
    rules.push({ kind: 'command', match: verdict.rule });
  }
  if (rules.length === 0) return { rules: [], refusal: 'This command has nothing to remember.' };
  return { rules };
}

// ── Read-only inspection (D-150) ────────────────────────────────

/** Programs that only read and print. `sed`, `sort` and `git` have per-argument conditions below. */
const INSPECTORS: ReadonlySet<string> = new Set([
  'cat', 'head', 'tail', 'ls', 'pwd', 'wc', 'nl', 'grep', 'egrep', 'fgrep', 'rg', 'echo', 'printf', 'diff', 'stat',
  'file', 'which', 'basename', 'dirname', 'cut', 'tr', 'sort', 'sed', 'cd', 'true',
]);
const INSPECTING_GIT: ReadonlySet<string> = new Set(['status', 'diff', 'log', 'show', 'blame', 'rev-parse', 'ls-files', 'grep']);
/** Shells whose `-c` script is the real command line (Codex sends `/bin/zsh -lc '<line>'`). */
const WRAPPING_SHELLS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh']);

/** A path argument, or the value glued to a flag (`-f/etc/x`, `--file=~/x`), that leaves the working directory. */
function argLeaves(text: string): boolean {
  return leavesWorkspace(text) || leavesWorkspace(text.replace(/^--?[A-Za-z0-9-]+=?/, ''));
}

function inspects(words: readonly Word[]): boolean {
  if (words.length === 0 || words.some((w) => w.dynamic)) return false;
  const base = words[0]!.text.replace(/^.*[\\/]/, '');
  const args = words.slice(1).map((w) => w.text);
  if (args.some(argLeaves)) return false;
  if (base === 'git') {
    // No global flags (`-C`, `-c`, `--git-dir`): the subcommand comes first, and it only reads.
    return INSPECTING_GIT.has(args[0] ?? '') && !args.some((a) => /^--(?:output|ext-diff|textconv)/.test(a));
  }
  if (!INSPECTORS.has(base)) return false;
  switch (base) {
    case 'cd':
      // Exactly one relative directory: a bare `cd` goes home, `cd -` somewhere unknown.
      return args.length === 1 && args[0] !== '-';
    case 'sed': {
      // Only `sed -n <lines>p <files>`: in-place edits, `w` and `e` commands write or run.
      const script = args.filter((a) => a !== '-n')[0];
      return args.includes('-n') && !!script && /^(?:\d+|\$)(?:,(?:\d+|\$))?p$/.test(script) && !args.some((a) => a.startsWith('-') && a !== '-n');
    }
    case 'sort':
      return !args.some((a) => a === '-o' || a.startsWith('--output') || /^-[a-zA-Z]*o/.test(a));
    case 'rg':
      return !args.some((a) => a.startsWith('--pre'));
    default:
      return true;
  }
}

/**
 * Whether a shell line only reads and prints inside the working directory: every command is an inspector
 * (`cat`, `sed -n 1,80p`, `grep`, `git diff` …), nothing expands, no output is redirected to a file, no path
 * leaves the workspace, and there is no control flow or here-document. "Accept edits" treats such a line as the
 * file read it is (D-150). A `sh|bash|zsh -c '<line>'` wrapper is judged by its line.
 */
export function isReadOnlyInspection(command: string, depth = 0): boolean {
  const parsed = new ShellLineParser(command).parse();
  if (parsed.problem || parsed.writesFile || parsed.commands.length === 0) return false;
  const [only] = parsed.commands;
  if (parsed.commands.length === 1 && only && depth === 0) {
    const base = only[0]!.text.replace(/^.*[\\/]/, '');
    if (WRAPPING_SHELLS.has(base) && only.length === 3 && /^-l?c$/.test(only[1]!.text) && !only[2]!.dynamic) {
      return isReadOnlyInspection(only[2]!.text, depth + 1);
    }
  }
  if (classifyPermissionRisk({ type: 'shell_exec', toolName: 'shell', inputSummary: command }).risk === 'risky') return false;
  return parsed.commands.every(inspects);
}

// ── Gates ───────────────────────────────────────────────────────

/** The rules "Allow for this chat/run" would add for a gate, or why it never may be remembered. */
export function rememberablePermission(subject: PermissionSubject): RememberablePermission {
  const tool = subject.toolName.trim();
  if (subject.alwaysAsk || ALWAYS_ASK_TOOLS.has(tool.toLowerCase())) {
    return { rules: [], refusal: 'This tool asks a person every time.' };
  }
  if (/^computer_/i.test(tool)) return { rules: [], refusal: 'Computer use asks a person every time.' };
  const isShell = subject.type === 'shell_exec';
  if (isShell && !subject.command?.trim()) return { rules: [], refusal: 'The command is not shown, so it always asks.' };
  const { risk, reasons } = classifyPermissionRisk({
    type: subject.type,
    toolName: tool,
    inputSummary: isShell ? subject.command : subject.inputSummary,
  });
  if (risk === 'risky') return { rules: [], refusal: `Risky requests always ask (${reasons.join(', ')}).` };
  if (isShell) return shellCommandRules(subject.command!);
  if (!tool) return { rules: [], refusal: 'The tool is not named, so it always asks.' };
  return { rules: [{ kind: 'tool', match: tool }] };
}

/** The rules a gate derives (empty when it cannot be remembered). */
export function permissionRulesFor(subject: PermissionSubject): PermissionRule[] {
  return rememberablePermission(subject).rules;
}

/** A rule's identity (`command:pnpm lint`). */
export function permissionRuleKey(rule: PermissionRule): string {
  return `${rule.kind}:${rule.match}`;
}

/**
 * Whether `rules` cover the gate: it derives at least one rule, and every one of them is among `rules` — every
 * command of a shell line, not just the first. A gate that cannot be remembered is never covered.
 */
export function rulesCover(rules: readonly PermissionRule[], subject: PermissionSubject): boolean {
  if (rules.length === 0) return false;
  const derived = rememberablePermission(subject).rules;
  if (derived.length === 0) return false;
  const have = new Set(rules.map(permissionRuleKey));
  return derived.every((r) => have.has(permissionRuleKey(r)));
}

/** Whether one rule alone covers the gate (a single-command line, or the tool). */
export function ruleMatches(rule: PermissionRule, subject: PermissionSubject): boolean {
  return rulesCover([rule], subject);
}

/** A short list of rules for one line of UI: `pnpm lint, git status +2`. */
export function summarizePermissionRules(rules: readonly PermissionRule[], max = 2): string {
  const shown = rules.slice(0, max).map((r) => r.match);
  const more = rules.length - shown.length;
  return more > 0 ? `${shown.join(', ')} +${more}` : shown.join(', ');
}
