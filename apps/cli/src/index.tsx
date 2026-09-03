#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// GeneratorAI CLI — entry point.
//
// Three surfaces live behind one binary:
//
//   generatorai <group> <verb>              scriptable, deterministic, pipeable
//   generatorai (bare on a TTY) / -i / tui  the interactive workbench
//   generatorai companion --stdio           machine gateway + host actions
//
// The command surface itself is not declared here. It is built by
// `buildRegistry()` in cli-core and projected onto Commander, so this file
// only owns process concerns: flags, signals, exit codes and teardown.
// ────────────────────────────────────────────────────────────────

import { Command, CommanderError } from 'commander';
import pc from 'picocolors';
import {
  attachCommands,
  buildRegistry,
  CliError,
  completeDynamic,
  EXIT_CODES,
  generateCompletions,
  SHELLS,
  toCliError,
  type CommandSpec,
  type Shell,
} from '@generatorai/cli-core';
import { createContextFor, createSession, type GlobalFlags, type Session } from './session.js';
import { pruneLogs } from './logger.js';
import { CLI_VERSION } from './version.js';
import { dynamicCompletionLookup } from './complete.js';

const program = new Command();
const registry = buildRegistry({ version: CLI_VERSION });

program
  .name('generatorai')
  .description('GeneratorAI — AI workflow engine from your terminal')
  .version(CLI_VERSION, '-V, --version', 'Show CLI version')
  .option('--json', 'Machine-readable JSON output')
  .option('--ndjson', 'One JSON object per line (streams without buffering)')
  .option('--yaml', 'YAML output')
  .option('-q, --quiet', 'Suppress output; report through the exit code only')
  .option('--server <url>', 'Server URL, bypassing the connection catalog')
  .option('--connection <name>', 'Named connection to use')
  .option('--api-key <key>', 'Legacy shared API key (deprecated — use `device pair`)')
  .option('--config-profile <name>', 'Named config profile')
  .option('-y, --yes', 'Assume yes for confirmations')
  .option('--timeout <ms>', 'Abort the command after this many milliseconds')
  .option('--verbose', 'Debug logging to stderr')
  .option('--no-color', 'Disable colour')
  .option('--no-unicode', 'ASCII-only output')
  .option('-i, --interactive', 'Launch the interactive terminal UI')
  .showSuggestionAfterError(false)
  .configureOutput({
    // Commander writes some of its own output to stdout by default, which
    // corrupts `--json` pipelines. Everything diagnostic belongs on stderr.
    writeOut: (text) => process.stdout.write(text),
    writeErr: (text) => process.stderr.write(text),
  });

// One session per process, created on first use so `--help` costs nothing.
let sessionPromise: Promise<Session> | undefined;
function getSession(): Promise<Session> {
  if (!sessionPromise) sessionPromise = createSession(program.opts<GlobalFlags>());
  return sessionPromise;
}

// SIGINT aborts in-flight work rather than killing the process outright, so
// SSE sockets, WebSockets and PTYs are torn down by their own disposers. The
// previous CLI called `process.exit()` from its handler and leaked all three.
const abort = new AbortController();
let interrupted = false;

function onInterrupt(signal: NodeJS.Signals): void {
  if (interrupted) {
    // A second Ctrl+C means "I meant it" — stop waiting for a clean unwind.
    process.exit(EXIT_CODES.CANCELLED);
  }
  interrupted = true;
  abort.abort();
  process.stderr.write(pc.dim(`\nReceived ${signal}; finishing up (press again to force quit)\n`));
  // Backstop: if teardown wedges, do not leave the user with a dead prompt.
  const timer = setTimeout(() => process.exit(EXIT_CODES.CANCELLED), 4000);
  timer.unref();
}

process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onInterrupt);

async function reportError(error: unknown, spec?: CommandSpec): Promise<void> {
  const cliError = toCliError(error);
  const session = await getSession().catch(() => null);
  const json = session?.outputMode === 'json' || session?.outputMode === 'ndjson';

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ apiVersion: 1, kind: spec?.id ?? 'error', error: cliError.toJSON() })}\n`,
    );
  } else if (session?.outputMode !== 'quiet') {
    process.stderr.write(`${pc.red('error')} ${cliError.message}\n`);
    if (cliError.hint) process.stderr.write(`${pc.dim(cliError.hint)}\n`);
    for (const suggestion of cliError.suggestions) {
      process.stderr.write(`  ${pc.dim('›')} ${suggestion}\n`);
    }
    if (session?.config.cli.verbose && cliError.cause instanceof Error) {
      process.stderr.write(`${pc.dim(cliError.cause.stack ?? '')}\n`);
    }
  }

  session?.logger.error(cliError.message, { code: cliError.code, command: spec?.id });
  process.exitCode = cliError.exitCode;
}

attachCommands(program, registry, {
  async createContext(spec) {
    const session = await getSession();
    return createContextFor(spec, {
      session,
      flags: program.opts<GlobalFlags>(),
      signal: abort.signal,
    });
  },
  async render(spec, result) {
    const session = await getSession();
    session.renderer.render(spec, result);
  },
  onError: reportError,
});

// ── Surfaces that are not registry commands ──────────────────────

program
  .command('tui')
  .description('Launch the interactive terminal UI')
  .option('--restore', 'Reopen the tabs from the last session')
  .option('--inline', 'Render in normal scrollback instead of taking over the screen (screen readers, terminal recordings)')
  .action(async (options: { restore?: boolean; inline?: boolean }) => {
    const session = await getSession();
    const { launchTui } = await import('./tui/launch.js');
    await launchTui({
      session,
      flags: program.opts<GlobalFlags>(),
      registry,
      restore: Boolean(options.restore ?? session.config.tui.restoreLayout),
      inline: Boolean(options.inline),
      signal: abort.signal,
    });
  });

program
  .command('companion')
  .description('Machine gateway over stdio (NDJSON) plus host-only capabilities')
  .option('--stdio', 'Speak NDJSON on stdin/stdout (default)')
  .option('--socket <path>', 'Listen on a Unix socket / Windows named pipe instead')
  .action(async (options: { socket?: string }) => {
    const session = await getSession();
    const { startCompanion } = await import('./companion/server.js');
    await startCompanion({
      session,
      flags: program.opts<GlobalFlags>(),
      registry,
      ...(options.socket ? { socketPath: options.socket } : {}),
      signal: abort.signal,
    });
  });

program
  .command('completions <shell>')
  .description(`Generate a completion script (${SHELLS.join(' | ')})`)
  .action((shell: string) => {
    if (!SHELLS.includes(shell as Shell)) {
      throw CliError.usage(`Unknown shell "${shell}".`, {
        hint: `Supported: ${SHELLS.join(', ')}`,
      });
    }
    process.stdout.write(generateCompletions(registry, shell as Shell));
  });

// Dynamic completion. Hidden because it is called by shells, never by people,
// and it must never print an error — a shell would offer it as a candidate.
program
  .command('__complete <line...>')
  .description('Internal: dynamic completion candidates')
  .action(async (line: string[]) => {
    try {
      const candidates = await completeDynamic({
        line: line.join(' '),
        registry,
        lookup: (source, prefix) =>
          dynamicCompletionLookup(source, prefix, {
            getSession,
            flags: program.opts<GlobalFlags>(),
            signal: abort.signal,
          }),
      });
      process.stdout.write(`${candidates.join('\n')}\n`);
    } catch {
      process.stdout.write('\n');
    }
  });

program.exitOverride();

async function main(): Promise<void> {
  pruneLogs();

  const argv = process.argv.slice(2);
  const wantsTui =
    argv.includes('-i') ||
    argv.includes('--interactive') ||
    // A bare invocation on a TTY opens the workbench; piped or in CI it must
    // still print help, or `generatorai | head` would hang on a full-screen app.
    (argv.length === 0 && Boolean(process.stdout.isTTY) && !process.env['CI']);

  if (wantsTui) {
    const session = await getSession();
    const { launchTui } = await import('./tui/launch.js');
    await launchTui({
      session,
      flags: program.opts<GlobalFlags>(),
      registry,
      restore: session.config.tui.restoreLayout,
      inline: argv.includes('--inline'),
      signal: abort.signal,
    });
    return;
  }

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      // `--help` and `--version` throw to unwind; they are not failures.
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
        process.exitCode = 0;
        return;
      }
      if (error.code === 'commander.unknownCommand') {
        const attempted = argv.filter((a) => !a.startsWith('-'));
        const suggestions = registry.didYouMean(attempted);
        await reportError(
          CliError.usage(`Unknown command: ${attempted.join(' ')}`, {
            ...(suggestions.length
              ? { hint: 'Did you mean:', suggestions: suggestions.map((s) => `generatorai ${s}`) }
              : { suggestions: ['generatorai --help'] }),
          }),
        );
        return;
      }
      process.exitCode = error.exitCode || EXIT_CODES.USAGE;
      return;
    }
    await reportError(error);
  } finally {
    await (await getSession().catch(() => null))?.dispose();
  }
}

void main();

export { registry };
