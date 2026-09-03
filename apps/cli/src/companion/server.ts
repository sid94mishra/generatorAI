// ────────────────────────────────────────────────────────────────
// Companion mode — the machine gateway.
//
// Two responsibilities:
//
//   1. Every registry command, callable as an RPC method, so the desktop app,
//      the server, or another agent can drive the CLI without parsing output
//      meant for humans.
//   2. Host-side capabilities the SERVER cannot have, because the server may
//      be on a different machine: opening a file, running an allowlisted
//      command, reading the clipboard, raising a notification.
//
// Security posture, deliberately narrow:
//   - stdio, or a 0600 socket. Never a TCP port.
//   - A nonce handed over by the parent process, mirroring the server's own
//     `local-admin.json` contract. A mismatched nonce exits immediately.
//   - `host.spawn` is allowlisted to the same commands the `script` hook
//     allows. `cmd.exe` is denied, matching the platform invariant.
//   - Every `host.*` call is appended to an audit log.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as net from 'node:net';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  CliContext,
  createCliClient,
  getCompanionAuditPath,
  toCliError,
  toRpcMethods,
  validate,
  type CommandRegistry,
  type CommandSpec,
  type TerminalAttachPort,
} from '@generatorai/cli-core';
import { createLogger } from '../logger.js';
import type { GlobalFlags, Session } from '../session.js';

const PROTOCOL_VERSION = 1;

/** Same allowlist the `script` hook uses. `cmd.exe` is absent by design. */
const SPAWN_ALLOWLIST = new Set(['node', 'python', 'python3', 'bash', 'sh', 'git', 'echo', 'pwsh']);

export interface Request {
  v?: number;
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
}

export type Frame =
  | { v: number; id: string; ok: true; data: unknown }
  | { v: number; id: string; ok: false; error: Record<string, unknown> }
  | { v: number; id: string; event: Record<string, unknown> };

export interface CompanionOptions {
  session: Session;
  flags: GlobalFlags;
  registry: CommandRegistry;
  socketPath?: string;
  signal: AbortSignal;
}

export async function startCompanion(options: CompanionOptions): Promise<void> {
  const { session, signal } = options;

  let expectedNonce = process.env['GENERATORAI_COMPANION_NONCE'] ?? null;
  const logger = createLogger({
    verbose: session.config.cli.verbose,
    capabilities: session.capabilities,
    silentStderr: true,
  });

  // A socket outlives the launching process and, on Windows, carries no
  // filesystem permissions to fall back on. Stdio is implicitly authenticated
  // by being a pipe the parent created; a socket is not, so it always needs a
  // handshake. One is minted and printed if the caller did not supply one.
  if (options.socketPath && !expectedNonce) {
    expectedNonce = randomBytes(32).toString('base64url');
    process.stderr.write(
      `companion: pairing nonce for this session\n  ${expectedNonce}\n` +
        '  Send it as { "method": "handshake", "params": { "nonce": "…" } } before anything else.\n',
    );
  }

  const audit = await openAudit();

  const shared = createSharedState({
    ...options,
    logger,
    audit,
    expectedNonce,
  });

  if (options.socketPath) {
    await serveSocket(options.socketPath, shared, signal);
    return;
  }
  await serveStdio(shared, signal);
}

// ── Transports ────────────────────────────────────────────────────

type Handler = (
  request: Request,
  emit: (frame: Frame) => void,
) => Promise<Frame | null>;

export async function serveStdio(
  shared: SharedCompanionState,
  signal: AbortSignal,
  io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream } = {
    input: process.stdin,
    output: process.stdout,
  },
): Promise<void> {
  const rl = readline.createInterface({ input: io.input, crlfDelay: Infinity });
  const write = (frame: Frame) => io.output.write(`${JSON.stringify(frame)}\n`);

  // Stdio has exactly one peer — the process that spawned this one — so a
  // failed handshake ending the whole channel is correct here, unlike the
  // socket transport below where other peers must be unaffected.
  const { handle, abortAll } = createConnectionHandler(shared, () => {
    setTimeout(() => process.exit(77), 10);
  });

  const done = new Promise<void>((resolve) => {
    // Same reasoning as the socket transport's `socket.on('close', abortAll)`
    // — ordinary teardown (parent closed stdin, or SIGINT abort) must not
    // leave this connection's in-flight requests/timers running with no way
    // left to cancel them.
    rl.on('close', () => {
      abortAll();
      resolve();
    });
    signal.addEventListener('abort', () => rl.close(), { once: true });
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    void handleLine(line, handle, write);
  }
  await done;
}

async function serveSocket(
  socketPath: string,
  shared: SharedCompanionState,
  signal: AbortSignal,
): Promise<void> {
  // A stale socket file from a crashed run would make bind fail; removing it
  // is safe because we are about to own the path.
  if (process.platform !== 'win32') {
    await fsp.rm(socketPath, { force: true });
  }

  const server = net.createServer((socket) => {
    // Fresh handshake and in-flight state for THIS socket only. Without a
    // per-connection handler, one client's successful `hello` — or one
    // client's bad nonce — would leak onto every other socket this process
    // ever accepts, since a single shared `authenticated`/`inFlight` closure
    // has no notion of which peer it belongs to.
    //
    // `onAuthFailure` runs BEFORE `handle()` returns the NOAUTH frame, and
    // `handleLine` only writes that frame once `handle()` resolves — so it
    // cannot close the socket itself; it only sets a flag `write` checks
    // after sending. Closing synchronously here (the original code) made
    // `write`'s `!socket.destroyed` guard false by the time it ran, so the
    // peer got an abrupt close with no explanation instead of the NOAUTH
    // frame. `socket.end()` right after the write avoids that (it flushes
    // pending writes before closing) but only half-closes the connection —
    // the peer's `close` never fires unless it also ends its own side.
    // Passing the destroy as `socket.write`'s own completion callback is
    // the ordering that is both correct and simple: Node only invokes it
    // once the data has been handed to the OS, and `destroy()` (not
    // `end()`) still fully tears the connection down so `close` fires
    // promptly on both ends.
    let closeAfterWrite = false;
    const { handle, abortAll } = createConnectionHandler(shared, () => {
      closeAfterWrite = true;
    });

    const rl = readline.createInterface({ input: socket, crlfDelay: Infinity });
    const write = (frame: Frame) => {
      if (socket.destroyed) return;
      if (closeAfterWrite) {
        socket.write(`${JSON.stringify(frame)}\n`, () => socket.destroy());
      } else {
        socket.write(`${JSON.stringify(frame)}\n`);
      }
    };
    rl.on('line', (line) => {
      if (line.trim()) void handleLine(line, handle, write);
    });
    // A request left running after its socket disappears is a leaked
    // process/timer with no way left to cancel it; abort them all on close.
    socket.on('close', abortAll);
    socket.on('error', () => socket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });

  if (process.platform !== 'win32') {
    // Owner-only: the socket is a full command channel into this account.
    await fsp.chmod(socketPath, 0o600);
  }

  await new Promise<void>((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        server.close(() => resolve());
      },
      { once: true },
    );
    server.once('close', resolve);
  });

  if (process.platform !== 'win32') {
    await fsp.rm(socketPath, { force: true });
  }
}

async function handleLine(
  line: string,
  handler: Handler,
  write: (frame: Frame) => void,
): Promise<void> {
  let request: Request;
  try {
    request = JSON.parse(line) as Request;
  } catch {
    write({
      v: PROTOCOL_VERSION,
      id: 'parse-error',
      ok: false,
      error: { code: 'PARSE_ERROR', message: 'Each line must be one JSON object.' },
    });
    return;
  }

  const response = await handler(request, write).catch((error: unknown) => {
    const cliError = toCliError(error);
    return {
      v: PROTOCOL_VERSION,
      id: request.id ?? 'unknown',
      ok: false as const,
      error: cliError.toJSON(),
    };
  });

  if (response) write(response);
}

// ── Dispatch ──────────────────────────────────────────────────────

export interface HandlerOptions extends CompanionOptions {
  logger: ReturnType<typeof createLogger>;
  audit: fs.WriteStream | null;
  expectedNonce: string | null;
}

/**
 * State that is legitimately process-wide: the command registry, the one
 * underlying authenticated client used to talk to the real GeneratorAI
 * server (expensive to build, and unrelated to which companion peer is
 * asking), and the launch nonce every peer is checked against.
 *
 * Deliberately does NOT include `authenticated` or `inFlight` — those belong
 * to one peer's connection, not to the companion process. See
 * {@link createConnectionHandler}.
 */
export interface SharedCompanionState {
  registry: CommandRegistry;
  session: Session;
  flags: GlobalFlags;
  signal: AbortSignal;
  logger: ReturnType<typeof createLogger>;
  audit: fs.WriteStream | null;
  expectedNonce: string | null;
  methods: Map<string, ReturnType<typeof toRpcMethods>[number]>;
  getClient: () => ReturnType<typeof createCliClient>;
}

export function createSharedState(options: HandlerOptions): SharedCompanionState {
  const { registry, session, flags, signal, logger, audit, expectedNonce } = options;
  const methods = new Map(toRpcMethods(registry).map((m) => [m.method, m]));

  let clientPromise: ReturnType<typeof createCliClient> | null = null;
  const getClient = () => {
    if (!clientPromise) {
      clientPromise = createCliClient({
        config: session.config,
        ...(flags.server ? { serverUrl: flags.server } : {}),
        ...(flags.connection ? { connectionRef: flags.connection } : {}),
        signal,
      });
      // Non-fatal: the server is ahead of what this CLI build understands.
      // Logged once, here, rather than per-request — `clientPromise` is
      // memoized, so this only ever runs on the connection's first command.
      clientPromise.then((client) => {
        if (client.protocolWarning) logger.warn(client.protocolWarning);
      }, () => {});
    }
    return clientPromise;
  };

  return { registry, session, flags, signal, logger, audit, expectedNonce, methods, getClient };
}

export interface ConnectionHandler {
  handle: Handler;
  /** Aborts every request still running on this connection. Call on disconnect. */
  abortAll: () => void;
}

/**
 * Builds a handler scoped to ONE peer — one socket, or (for stdio) the
 * process's single lifetime. `authenticated` and `inFlight` live in this
 * closure, created fresh per call, so one peer's handshake result and one
 * peer's cancellations can never be observed or triggered by another.
 *
 * `onAuthFailure` is the only transport-specific policy left: stdio has one
 * peer, so it can end the whole channel; a socket must only lose the one
 * connection that sent the bad nonce.
 */
export function createConnectionHandler(
  shared: SharedCompanionState,
  onAuthFailure: () => void,
): ConnectionHandler {
  const { registry, session, signal, logger, audit, expectedNonce, methods, getClient } = shared;
  const inFlight = new Map<string, AbortController>();
  let authenticated = expectedNonce === null;

  const handle: Handler = async (request, emit) => {
    const id = request.id ?? 'unknown';
    const method = request.method ?? '';
    const params = request.params ?? {};

    const fail = (code: string, message: string, hint?: string): Frame => ({
      v: PROTOCOL_VERSION,
      id,
      ok: false,
      error: { code, message, ...(hint ? { hint } : {}) },
    });

    if (request.v !== undefined && request.v !== PROTOCOL_VERSION) {
      return fail('VERSION_MISMATCH', `This companion speaks protocol v${PROTOCOL_VERSION}.`);
    }

    // The handshake is the only method accepted before authentication, so a
    // process that got hold of the socket cannot enumerate anything first.
    if (method === 'hello') {
      if (expectedNonce && params['nonce'] !== expectedNonce) {
        logger.error('Companion handshake rejected: bad nonce');
        // `onAuthFailure` decides the blast radius: stdio has one peer, so
        // it ends the whole process; a socket loses only this connection.
        // Either way, a wrong nonce means THIS peer is not who the channel
        // was opened for — it never touches any other connection's state.
        onAuthFailure();
        return fail('NOAUTH', 'Handshake rejected.');
      }
      authenticated = true;
      return {
        v: PROTOCOL_VERSION,
        id,
        ok: true,
        data: {
          protocol: PROTOCOL_VERSION,
          methods: methods.size,
          host: process.platform,
          pid: process.pid,
        },
      };
    }

    if (!authenticated) {
      return fail('NOAUTH', 'Send `hello` with the launch nonce first.');
    }

    switch (method) {
      case 'ping':
        return { v: PROTOCOL_VERSION, id, ok: true, data: { pong: Date.now() } };

      case 'describe':
        return {
          v: PROTOCOL_VERSION,
          id,
          ok: true,
          data: { protocol: PROTOCOL_VERSION, methods: [...methods.values()] },
        };

      case 'cancel': {
        const target = String(params['target'] ?? '');
        const controller = inFlight.get(target);
        controller?.abort();
        return { v: PROTOCOL_VERSION, id, ok: true, data: { cancelled: Boolean(controller) } };
      }
    }

    if (method.startsWith('host.')) {
      const result = await runHostMethod(method, params, { audit, logger });
      return { v: PROTOCOL_VERSION, id, ok: true, data: result };
    }

    const spec = registry.get(method);
    if (!spec || !methods.has(method)) {
      return fail('NOT_FOUND', `Unknown method "${method}".`, 'Call `describe` for the list.');
    }

    const controller = new AbortController();
    inFlight.set(id, controller);
    const onOuterAbort = () => controller.abort();
    signal.addEventListener('abort', onOuterAbort, { once: true });

    let context: CliContext | null = null;
    try {
      const validated = validate(spec, {
        args: (params['args'] as Record<string, unknown>) ?? {},
        flags: (params['flags'] as Record<string, unknown>) ?? {},
      });

      // The confirmation gate on the other two surfaces lives in their own
      // dispatchers, so calling `spec.handler` directly would let a peer
      // delete a project with no acknowledgement at all. `assumeYes: false`
      // is not a substitute: no handler asks.
      if (spec.destructive && (validated.flags as { yes?: unknown }).yes !== true) {
        return fail(
          'USAGE',
          `"${method}" is destructive and needs an explicit { "flags": { "yes": true } }.`,
          'That acknowledgement is the only confirmation this channel has.',
        );
      }

      context = await buildContext(spec, {
        client: await getClient(),
        session,
        logger,
        signal: controller.signal,
        emit: (event) =>
          emit({ v: PROTOCOL_VERSION, id, event: event as unknown as Record<string, unknown> }),
      });

      const result = await spec.handler(context, validated);
      return {
        v: PROTOCOL_VERSION,
        id,
        ok: true,
        data: {
          data: result.data,
          ...(result.warnings?.length ? { warnings: result.warnings } : {}),
          ...(result.message ? { message: result.message } : {}),
        },
      };
    } finally {
      signal.removeEventListener('abort', onOuterAbort);
      inFlight.delete(id);
      await context?.dispose();
    }
  };

  return {
    handle,
    abortAll: () => {
      for (const controller of inFlight.values()) controller.abort();
      inFlight.clear();
    },
  };
}

async function buildContext(
  spec: CommandSpec,
  options: {
    client: Awaited<ReturnType<typeof createCliClient>>;
    session: Session;
    logger: ReturnType<typeof createLogger>;
    signal: AbortSignal;
    emit: (event: unknown) => void;
  },
): Promise<CliContext> {
  const { client, session, logger, signal, emit } = options;

  return new CliContext({
    api: client.api,
    config: session.config,
    connection: client.connection
      ? { ...client.connection, resolvedEndpoint: client.baseUrl }
      : null,
    capabilities: session.capabilities,
    logger,
    // A machine caller cannot answer a prompt mid-request. Confirmations
    // resolve to the safe default; a caller that means it passes `yes`.
    prompt: {
      confirm: async (_message, defaultValue) => defaultValue,
      text: async (_message, defaultValue) => defaultValue ?? '',
      select: async (_message, choices) => choices[0] as never,
      password: async () => {
        throw new Error('Companion mode never collects secrets.');
      },
    },
    stream: client.stream,
    // `terminal.attach` is `inRpc: false` — no companion caller can ever
    // dispatch it — but a `CliContext` still needs a real value here rather
    // than `undefined`, and this machine gateway has no local terminal to
    // hand over even in principle.
    terminalAttach: {
      attach() {
        throw toCliError(new Error('Raw terminal attach has no meaning over the companion RPC.'));
      },
    } satisfies TerminalAttachPort,
    emit,
    signal,
    interactive: false,
    // Destructive commands still require an explicit `flags.yes` from the
    // caller; this only stops the confirmation from deadlocking.
    assumeYes: Boolean(spec.destructive) === false,
    verbose: session.config.cli.verbose,
    timeoutMs: session.config.server.timeoutMs,
    fetch: client.fetch,
    baseUrl: client.baseUrl,
  });
}

// ── Host capabilities ─────────────────────────────────────────────

async function runHostMethod(
  method: string,
  params: Record<string, unknown>,
  context: { audit: fs.WriteStream | null; logger: ReturnType<typeof createLogger> },
): Promise<unknown> {
  const record = (outcome: string, detail?: Record<string, unknown>) => {
    context.audit?.write(
      `${JSON.stringify({ at: new Date().toISOString(), method, outcome, ...detail })}\n`,
    );
  };

  switch (method) {
    case 'host.openPath': {
      const target = resolveSafe(String(params['path'] ?? ''));
      // `explorer.exe` takes the path as a discrete argv entry. The previous
      // `pwsh -Command Start-Process -FilePath <target>` form concatenated
      // its arguments into a *script*, so a path containing `;` executed
      // whatever followed it — with the spawn allowlist bypassed.
      const opener =
        process.platform === 'win32'
          ? { command: 'explorer.exe', args: [target] }
          : process.platform === 'darwin'
            ? { command: 'open', args: [target] }
            : { command: 'xdg-open', args: [target] };
      await runProcess(opener.command, opener.args, { allowUnlisted: true });
      record('ok', { path: target });
      return { opened: target };
    }

    case 'host.openEditor': {
      const target = resolveSafe(String(params['path'] ?? ''));
      const editor = process.env['VISUAL'] ?? process.env['EDITOR'] ?? 'vi';
      await runProcess(editor, [target], { allowUnlisted: true, inheritStdio: true });
      record('ok', { path: target, editor });
      return { edited: target };
    }

    case 'host.spawn': {
      const command = String(params['command'] ?? '');
      const args = Array.isArray(params['args']) ? (params['args'] as string[]).map(String) : [];
      if (!SPAWN_ALLOWLIST.has(path.basename(command).replace(/\.exe$/i, ''))) {
        record('denied', { command });
        throw toCliError(
          new Error(
            `"${command}" is not on the allowlist. Allowed: ${[...SPAWN_ALLOWLIST].sort().join(', ')}.`,
          ),
        );
      }
      const result = await runProcess(command, args, {});
      record('ok', { command, exitCode: result.code });
      return result;
    }

    case 'host.notify': {
      const title = String(params['title'] ?? 'GeneratorAI');
      const body = String(params['body'] ?? '');
      await notify(title, body);
      record('ok', { title });
      return { notified: true };
    }

    case 'host.clipboard.write': {
      const text = String(params['text'] ?? '');
      await writeClipboard(text);
      record('ok', { bytes: text.length });
      return { written: text.length };
    }

    case 'host.env':
      // Deliberately narrow: the full environment routinely contains tokens,
      // and a machine caller has no business enumerating it.
      record('ok');
      return {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        cwd: process.cwd(),
        home: process.env['HOME'] ?? process.env['USERPROFILE'] ?? null,
        shell: process.env['SHELL'] ?? process.env['ComSpec'] ?? null,
      };

    default:
      record('unknown');
      throw toCliError(new Error(`Unknown host method "${method}".`));
  }
}

/** Characters that turn an argument into a command in any common shell. */
const SHELL_METACHARACTERS = /[;&|`$<>\r\n]|\$\(/;

/**
 * Canonicalises a path and refuses anything that escapes the user's home or
 * the working directory. A companion is a local privilege boundary, not a
 * general-purpose file server.
 */
function resolveSafe(input: string): string {
  if (!input) throw toCliError(new Error('A path is required.'));
  // Defence in depth. Every caller below passes the path as its own argv
  // entry, but one future caller reaching for a shell would silently turn
  // this into remote code execution.
  if (SHELL_METACHARACTERS.test(input)) {
    throw toCliError(new Error('Refusing a path containing shell metacharacters.'));
  }
  const resolved = path.resolve(input);
  const roots = [process.cwd(), process.env['HOME'] ?? process.env['USERPROFILE'] ?? ''].filter(
    Boolean,
  );
  const permitted = roots.some((root) => {
    const relative = path.relative(root, resolved);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
  if (!permitted) {
    throw toCliError(new Error(`Refusing to touch a path outside the workspace or home: ${resolved}`));
  }
  return resolved;
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runProcess(
  command: string,
  args: string[],
  options: { allowUnlisted?: boolean; inheritStdio?: boolean },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      // `shell: false` is the point: with a shell, an argument containing
      // `; rm -rf ~` would be executed, and the allowlist would be theatre.
      shell: false,
      stdio: options.inheritStdio ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function notify(title: string, body: string): Promise<void> {
  try {
    if (process.platform === 'darwin') {
      await runProcess('osascript', ['-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`], { allowUnlisted: true });
      return;
    }
    if (process.platform === 'linux') {
      await runProcess('notify-send', [title, body], { allowUnlisted: true });
      return;
    }
    // Windows: BurntToast is not guaranteed, so fall back to the bell rather
    // than failing a best-effort courtesy.
    process.stderr.write('\u0007');
  } catch {
    process.stderr.write('\u0007');
  }
}

async function writeClipboard(text: string): Promise<void> {
  const command =
    process.platform === 'darwin'
      ? { bin: 'pbcopy', args: [] }
      : process.platform === 'win32'
        ? { bin: 'clip', args: [] }
        : { bin: 'xclip', args: ['-selection', 'clipboard'] };

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.bin, command.args, { shell: false, windowsHide: true });
    child.on('error', reject);
    child.on('close', () => resolve());
    child.stdin.end(text);
  });
}

async function openAudit(): Promise<fs.WriteStream | null> {
  try {
    const file = getCompanionAuditPath();
    await fsp.mkdir(path.dirname(file), { recursive: true });
    return fs.createWriteStream(file, { flags: 'a', mode: 0o600 });
  } catch {
    return null;
  }
}
