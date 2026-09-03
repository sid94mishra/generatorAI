// ────────────────────────────────────────────────────────────────
// Building a CliContext for the binary surface.
//
// Deliberately lazy: `--help`, `config` and `device pair` must work with no
// server, no credential and no network, so nothing here touches the wire
// until a command that declared `requiresServer` asks for it.
// ────────────────────────────────────────────────────────────────

import { confirm, input, password, select } from '@inquirer/prompts';
import {
  CliContext,
  CliError,
  createCliClient,
  detectTerminal,
  loadConfig,
  type Api,
  type CliEvent,
  type CommandSpec,
  type Logger,
  type PromptPort,
  type ResolvedCliConfig,
  type StreamPort,
  type TerminalAttachPort,
  type TerminalCapabilities,
} from '@generatorai/cli-core';
import { Renderer, type OutputMode } from './render/Renderer.js';
import { createLogger } from './logger.js';
import { attachToTerminal } from './terminal/attachLoop.js';

export interface GlobalFlags {
  json?: boolean;
  ndjson?: boolean;
  yaml?: boolean;
  quiet?: boolean;
  server?: string;
  connection?: string;
  apiKey?: string;
  configProfile?: string;
  verbose?: boolean;
  color?: boolean;
  unicode?: boolean;
  yes?: boolean;
  timeout?: string;
  local?: boolean;
}

export interface Session {
  config: ResolvedCliConfig;
  capabilities: TerminalCapabilities;
  renderer: Renderer;
  logger: Logger;
  outputMode: OutputMode;
  dispose(): Promise<void>;
}

function resolveOutputMode(flags: GlobalFlags, config: ResolvedCliConfig): OutputMode {
  if (flags.quiet) return 'quiet';
  if (flags.ndjson) return 'ndjson';
  if (flags.yaml) return 'yaml';
  if (flags.json) return 'json';
  if (config.cli.output !== 'auto') return config.cli.output;
  return 'auto';
}

/**
 * Loads config and terminal capabilities once per process.
 *
 * Commander invokes actions after the whole argv is parsed, so this runs at
 * most once even for a command with subcommands.
 */
export async function createSession(flags: GlobalFlags): Promise<Session> {
  const cliFlags: Record<string, unknown> = {};
  const flagNames: string[] = [];

  if (flags.server) {
    cliFlags['server'] = { url: flags.server };
    flagNames.push('--server');
  }
  if (flags.apiKey) {
    cliFlags['server'] = { ...(cliFlags['server'] as object | undefined), apiKey: flags.apiKey };
    flagNames.push('--api-key');
  }
  if (flags.configProfile) {
    cliFlags['activeProfile'] = flags.configProfile;
    flagNames.push('--config-profile');
  }
  if (flags.connection) {
    cliFlags['activeConnection'] = flags.connection;
    flagNames.push('--connection');
  }
  if (flags.verbose) {
    cliFlags['cli'] = { ...(cliFlags['cli'] as object | undefined), verbose: true };
    flagNames.push('--verbose');
  }
  if (flags.color === false) {
    cliFlags['cli'] = { ...(cliFlags['cli'] as object | undefined), color: 'never' };
    flagNames.push('--no-color');
  }
  if (flags.unicode === false) {
    cliFlags['cli'] = { ...(cliFlags['cli'] as object | undefined), unicode: false };
    flagNames.push('--no-unicode');
  }
  if (flags.timeout !== undefined) {
    const timeoutMs = Number(flags.timeout);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw CliError.usage(`--timeout expects milliseconds, got "${flags.timeout}".`);
    }
    cliFlags['server'] = { ...(cliFlags['server'] as object | undefined), timeoutMs };
    flagNames.push('--timeout');
  }
  if (flags.yes) {
    cliFlags['cli'] = { ...(cliFlags['cli'] as object | undefined), assumeYes: true };
    flagNames.push('--yes');
  }

  const config = await loadConfig({ flags: cliFlags, flagNames });

  const capabilities = detectTerminal({
    overrides: {
      ...(config.cli.color === 'never' ? { colorDepth: 'none' as const } : {}),
      ...(config.cli.unicode === false ? { unicode: false } : {}),
    },
  });

  const outputMode = resolveOutputMode(flags, config);
  const useColor = config.cli.color !== 'never' && capabilities.colorDepth !== 'none' && outputMode === 'auto';

  const logger = createLogger({ verbose: config.cli.verbose, capabilities });

  const renderer = new Renderer({
    mode: outputMode,
    capabilities,
    color: useColor,
    unicode: config.cli.unicode && capabilities.unicode,
    write: (text) => process.stdout.write(text),
    writeError: (text) => process.stderr.write(text),
  });

  return {
    config,
    capabilities,
    renderer,
    logger,
    outputMode,
    async dispose() {
      // Nothing global to release yet; kept so the entry point has one place
      // to hang process-level teardown when it needs it.
    },
  };
}

/**
 * A prompt port that never blocks when nobody can answer.
 *
 * `--json` and CI must not hang waiting for a keystroke, so a
 * non-interactive session returns the default rather than reading stdin.
 */
function createPrompt(interactive: boolean): PromptPort {
  if (!interactive) {
    return {
      async confirm(_message, defaultValue) {
        return defaultValue;
      },
      async text(_message, defaultValue) {
        return defaultValue ?? '';
      },
      async select(_message, choices) {
        const first = choices[0];
        if (!first) throw CliError.usage('No choices available.');
        return first;
      },
      async password() {
        throw CliError.usage('A secret is required but this session is not interactive.', {
          hint: 'Run the command in a terminal, or supply the value through the environment.',
        });
      },
    };
  }

  return {
    confirm: (message, defaultValue) => confirm({ message, default: defaultValue }),
    text: (message, defaultValue) =>
      input(defaultValue === undefined ? { message } : { message, default: defaultValue }),
    select: (message, choices) =>
      select({ message, choices: choices.map((value) => ({ value })) }) as unknown as Promise<never>,
    password: (message) => password({ message, mask: true }),
  };
}

export interface ContextFactoryOptions {
  session: Session;
  flags: GlobalFlags;
  /** Aborted on SIGINT so in-flight requests and streams unwind. */
  signal: AbortSignal;
}

export async function createContextFor(
  spec: CommandSpec,
  options: ContextFactoryOptions,
): Promise<CliContext> {
  const { session, flags, signal } = options;

  // `--json`/`--yaml` promise exactly one bounded document; a command that
  // follows a conversation forever (`chat watch`) can never produce one.
  // Refusing here, before any request goes out, beats hanging with no
  // output until the process is killed.
  if (
    spec.output.kind === 'stream' &&
    spec.output.unbounded &&
    (session.outputMode === 'json' || session.outputMode === 'yaml')
  ) {
    throw CliError.unsupported(
      `\`${spec.id}\` streams indefinitely and cannot produce a single ${session.outputMode.toUpperCase()} document.`,
      { hint: 'Use --ndjson, which is designed for unbounded output, one versioned frame per line.' },
    );
  }

  const interactive =
    session.capabilities.interactive && session.outputMode === 'auto' && !flags.yes;

  const emit = (event: CliEvent) => {
    session.renderer.handleEvent(event as never);
  };

  // Commands that declared `requiresServer: false` get a client that throws
  // on first use rather than one that probes the network. `config show`
  // against an unreachable server must still print the config.
  if (!spec.requiresServer) {
    const offlineApi = new Proxy({} as Api, {
      get() {
        throw new CliError('USAGE', `\`${spec.id}\` does not use the server.`, {
          hint: 'This is a bug in the command definition, not in your invocation.',
        });
      },
    });
    const offlineStream: StreamPort = {
      subscribe() {
        throw new CliError('USAGE', 'This command cannot stream.');
      },
    };
    const offlineTerminalAttach: TerminalAttachPort = {
      attach() {
        throw new CliError('USAGE', `\`${spec.id}\` does not use the server.`, {
          hint: 'This is a bug in the command definition, not in your invocation.',
        });
      },
    };

    return new CliContext({
      api: offlineApi,
      config: session.config,
      connection: null,
      capabilities: session.capabilities,
      logger: session.logger,
      prompt: createPrompt(interactive),
      stream: offlineStream,
      terminalAttach: offlineTerminalAttach,
      emit,
      signal,
      interactive,
      assumeYes: Boolean(flags.yes) || session.config.cli.assumeYes,
      verbose: session.config.cli.verbose,
      timeoutMs: Number(flags.timeout ?? session.config.server.timeoutMs) || 0,
      fetch: async () => {
        throw new CliError('USAGE', 'This command cannot reach the server.');
      },
      baseUrl: '',
    });
  }

  const client = await createCliClient({
    config: session.config,
    ...(flags.server ? { serverUrl: flags.server } : {}),
    ...(flags.connection ? { connectionRef: flags.connection } : {}),
    signal,
  });

  // Non-fatal: the server is ahead of what this CLI build understands.
  // `createCliClient` already refuses outright (VERSION_MISMATCH) when the
  // server is too OLD to talk to — this is the other, survivable direction.
  if (client.protocolWarning) {
    emit({ type: 'log', level: 'warn', message: client.protocolWarning });
  }

  // Real raw takeover for the binary surface's `terminal.attach` — plain
  // `process.stdin`/`process.stdout`, since there is no Ink frame to fight
  // for them here (contrast the TUI's own attach keybinding, which instead
  // goes through `useTerminalSuspension` and never touches this port).
  const terminalAttach: TerminalAttachPort = {
    attach(request) {
      return attachToTerminal({
        workspaceId: request.workspaceId,
        ...(request.terminalId ? { terminalId: request.terminalId } : {}),
        api: client.api.terminals,
        socketUrl: client.socketUrl,
        stdin: process.stdin,
        stdout: process.stdout,
        signal,
      });
    },
  };

  const context = new CliContext({
    api: client.api,
    config: session.config,
    connection: client.connection
      ? { ...client.connection, resolvedEndpoint: client.baseUrl }
      : null,
    capabilities: session.capabilities,
    logger: session.logger,
    prompt: createPrompt(interactive),
    stream: client.stream,
    terminalAttach,
    emit,
    signal,
    interactive,
    assumeYes: Boolean(flags.yes) || session.config.cli.assumeYes,
    verbose: session.config.cli.verbose,
    timeoutMs: Number(flags.timeout ?? session.config.server.timeoutMs) || 0,
    fetch: client.fetch,
    baseUrl: client.baseUrl,
  });

  context.onDispose(() => client.dispose());
  return context;
}
