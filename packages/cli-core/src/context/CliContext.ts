// ────────────────────────────────────────────────────────────────
// CliContext — everything a command handler is allowed to touch.
//
// Handlers receive this and nothing else. That is what makes them testable
// without a server, reusable across the binary / TUI / companion surfaces,
// and unable to reach for a global.
//
// Nothing here renders. `emit` hands a typed event to whichever surface is
// driving; `confirm` and `prompt` are supplied by the surface too, because a
// terminal prompt, a TUI modal and a companion RPC round-trip are three
// different things wearing one signature.
// ────────────────────────────────────────────────────────────────

import type { AdminApi, ApiClient } from '@generatorai/client-core';
import type { ResolvedCliConfig } from '../config/schema.js';
import type { ServerConnectionInfo } from '../connection/ConnectionManager.js';
import type { TerminalCapabilities } from '../capabilities/TerminalCapabilities.js';

/**
 * The full API surface: the shared read client plus the admin/write half.
 *
 * A plain `ApiClient & AdminApi` intersection is wrong here. Where both halves
 * declare a namespace (`runs`, `workspaces`, `agents`, `sourceControl`), the
 * intersection turns each overlapping method into an overload set and TS
 * resolves calls against the FIRST signature — the read client's — so
 * `workspaces.list()` type-checked as the phone-shaped summary while the
 * runtime object, built by spreading admin last, actually returned the
 * operator-shaped record. Deep-merging with admin priority makes the type
 * match the object.
 */
export type Api = DeepMergeApi<ApiClient, AdminApi>;

type AnyFn = (...args: never[]) => unknown;

type DeepMergeApi<A, B> = {
  [K in keyof A | keyof B]: K extends keyof B
    ? K extends keyof A
      ? A[K] extends AnyFn
        ? B[K]
        : B[K] extends AnyFn
          ? B[K]
          : DeepMergeApi<A[K], B[K]>
      : B[K]
    : K extends keyof A
      ? A[K]
      : never;
};

/** Progress and streamed output, surfaced however the calling surface likes. */
export type CliEvent =
  | { type: 'progress'; message: string; percent?: number }
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string }
  /** A domain event straight off the SSE stream. */
  | { type: 'stream'; kind: string; data: Record<string, unknown>; sequence?: number }
  /** Text destined for the user verbatim (token deltas, PTY bytes). */
  | { type: 'chunk'; text: string; channel?: 'stdout' | 'stderr' | 'thinking' }
  /** A row appended to a live table (parallel run watching). */
  | { type: 'row'; row: Record<string, unknown> };

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface PromptPort {
  /**
   * Yes/no. Must return the default without blocking when the surface is
   * non-interactive, so `--json` and CI never hang.
   */
  confirm(message: string, defaultValue: boolean): Promise<boolean>;
  text(message: string, defaultValue?: string): Promise<string>;
  select<T extends string>(message: string, choices: readonly T[]): Promise<T>;
  /** Never echoed and never logged. */
  password(message: string): Promise<string>;
}

/**
 * Subscription to the unified `/api/stream` endpoint.
 *
 * Returned as a disposer rather than an object because every call site wants
 * exactly one thing — to stop — and an object invites callers to hold a
 * reference past unmount.
 */
export interface StreamPort {
  subscribe(
    scope: 'session' | 'run' | 'chat' | 'global' | 'automation' | 'workspace',
    id: string,
    handler: (event: { kind: string; data: Record<string, unknown>; sequence?: number }) => void,
    options?: {
      afterSequence?: number;
      filter?: string[];
      onConnected?: () => void;
      onReconnecting?: (attempt: number) => void;
      onDisconnected?: (reason?: string) => void;
    },
  ): () => void;
}

/** What `terminal.attach` needs to say about a session to attach to. */
export interface TerminalAttachRequest {
  workspaceId: string;
  /** Existing session id; omit to have the port create a fresh one. */
  terminalId?: string;
}

/** How a raw terminal takeover ended. */
export interface TerminalAttachOutcome {
  reason: 'detached' | 'exited' | 'error' | 'aborted';
  /** Only meaningful when `reason === 'exited'`. */
  exitCode?: number | null;
  /** Set on `'error'`; occasionally set on `'exited'` (killed by signal). */
  message?: string;
}

/**
 * Raw terminal takeover — hands the caller's real stdin/stdout to a live
 * server-side PTY over WebSocket until the remote session exits or the user
 * detaches.
 *
 * `cli-core` deliberately does not import `ws`, and does not touch raw mode
 * itself — both are surface concerns (the binary CLI proxies its own
 * stdin/stdout; the TUI's terminal pane instead goes through Ink's terminal
 * suspension and never calls this port at all). Every surface must still
 * supply one: a surface with no terminal to hand over (the companion RPC
 * server) supplies a port that refuses cleanly rather than leaving this
 * `undefined` and letting a real command crash on `.attach is not a
 * function`.
 */
export interface TerminalAttachPort {
  attach(request: TerminalAttachRequest): Promise<TerminalAttachOutcome>;
}

export interface CliContextOptions {
  api: Api;
  config: ResolvedCliConfig;
  connection: ServerConnectionInfo | null;
  capabilities: TerminalCapabilities;
  logger: Logger;
  prompt: PromptPort;
  stream: StreamPort;
  terminalAttach: TerminalAttachPort;
  emit: (event: CliEvent) => void;
  signal: AbortSignal;
  /** True when the surface can ask the user something and get an answer. */
  interactive: boolean;
  /** Set by `--yes`; suppresses confirmations for destructive commands. */
  assumeYes: boolean;
  /** Set by `--verbose`. */
  verbose: boolean;
  /** Milliseconds, from `--timeout`. Zero means no limit. */
  timeoutMs: number;
  /** Raw fetch, already authenticated — for endpoints that return non-JSON. */
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** Base URL of the active server, for building WS URLs. */
  baseUrl: string;
}

export class CliContext {
  readonly api: Api;
  readonly config: ResolvedCliConfig;
  readonly connection: ServerConnectionInfo | null;
  readonly capabilities: TerminalCapabilities;
  readonly logger: Logger;
  readonly prompt: PromptPort;
  readonly stream: StreamPort;
  readonly terminalAttach: TerminalAttachPort;
  readonly signal: AbortSignal;
  readonly interactive: boolean;
  readonly assumeYes: boolean;
  readonly verbose: boolean;
  readonly timeoutMs: number;
  readonly fetch: (path: string, init?: RequestInit) => Promise<Response>;
  readonly baseUrl: string;

  private readonly emitter: (event: CliEvent) => void;
  private readonly disposers: Array<() => void> = [];

  constructor(options: CliContextOptions) {
    this.api = options.api;
    this.config = options.config;
    this.connection = options.connection;
    this.capabilities = options.capabilities;
    this.logger = options.logger;
    this.prompt = options.prompt;
    this.stream = options.stream;
    this.terminalAttach = options.terminalAttach;
    this.signal = options.signal;
    this.interactive = options.interactive;
    this.assumeYes = options.assumeYes;
    this.verbose = options.verbose;
    this.timeoutMs = options.timeoutMs;
    this.fetch = options.fetch;
    this.baseUrl = options.baseUrl;
    this.emitter = options.emit;
  }

  emit(event: CliEvent): void {
    this.emitter(event);
  }

  progress(message: string, percent?: number): void {
    this.emitter(percent === undefined ? { type: 'progress', message } : { type: 'progress', message, percent });
  }

  chunk(text: string, channel?: 'stdout' | 'stderr' | 'thinking'): void {
    this.emitter(channel ? { type: 'chunk', text, channel } : { type: 'chunk', text });
  }

  /**
   * Registers cleanup that runs when the command finishes, however it
   * finishes. Every SSE and WS subscription a handler opens must go through
   * here — the previous CLI called `process.exit()` from its SIGINT handler
   * and leaked every open socket.
   */
  onDispose(disposer: () => void): void {
    this.disposers.push(disposer);
  }

  async dispose(): Promise<void> {
    // Reverse order so a subscription is torn down before the transport it
    // was opened on.
    for (const disposer of this.disposers.reverse()) {
      try {
        disposer();
      } catch (error) {
        this.logger.debug('Disposer threw', { error: String(error) });
      }
    }
    this.disposers.length = 0;
  }

  /** Throws `CANCELLED` if the user has already interrupted. */
  assertNotCancelled(): void {
    if (this.signal.aborted) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }
  }

  /**
   * Confirmation gate for destructive commands.
   *
   * Non-interactive surfaces must pass `--yes` explicitly; defaulting to
   * "yes" when nobody is watching is how scripts delete production data.
   */
  async confirmDestructive(message: string): Promise<boolean> {
    if (this.assumeYes) return true;
    if (!this.interactive) return false;
    return this.prompt.confirm(message, false);
  }
}
