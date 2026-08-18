// ────────────────────────────────────────────────────────────────
// The CLI's error vocabulary.
//
// Every failure that reaches a surface is one of these, so a renderer can
// decide presentation from `code` alone and `main()` can map straight to an
// exit code. Anything else escaping to the top is a bug and is reported as
// such rather than being quietly formatted as a user error.
// ────────────────────────────────────────────────────────────────

/**
 * Exit codes. Stable — scripts branch on these.
 *
 * Values below 64 are ours; 64-78 follow sysexits.h so shell users get the
 * meaning they already expect from other tools.
 */
export const EXIT_CODES = {
  OK: 0,
  /** Catch-all failure. */
  ERROR: 1,
  /** Bad arguments, unknown command, failed schema validation. */
  USAGE: 2,
  /** The requested entity does not exist. */
  NOT_FOUND: 4,
  /** The operation completed but the result was a failure state (e.g. a run failed). */
  RESULT_FAILED: 5,
  /** Interrupted by the user (SIGINT). */
  CANCELLED: 130,
  /** Operation exceeded --timeout. */
  TIMEOUT: 124,
  /** Server unreachable. */
  UNAVAILABLE: 69,
  /** Not authenticated, or the credential was revoked. */
  NOAUTH: 77,
  /** Authenticated but missing the required scope. */
  FORBIDDEN: 78,
  /** CLI and server versions are incompatible. */
  VERSION_MISMATCH: 70,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export type CliErrorCode =
  | 'USAGE'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'AMBIGUOUS_REF'
  | 'CONFLICT'
  | 'UNAVAILABLE'
  | 'NOAUTH'
  | 'FORBIDDEN'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'VERSION_MISMATCH'
  | 'RESULT_FAILED'
  | 'INTERNAL';

const EXIT_BY_CODE: Record<CliErrorCode, ExitCode> = {
  USAGE: EXIT_CODES.USAGE,
  VALIDATION: EXIT_CODES.USAGE,
  NOT_FOUND: EXIT_CODES.NOT_FOUND,
  AMBIGUOUS_REF: EXIT_CODES.USAGE,
  CONFLICT: EXIT_CODES.ERROR,
  UNAVAILABLE: EXIT_CODES.UNAVAILABLE,
  NOAUTH: EXIT_CODES.NOAUTH,
  FORBIDDEN: EXIT_CODES.FORBIDDEN,
  TIMEOUT: EXIT_CODES.TIMEOUT,
  CANCELLED: EXIT_CODES.CANCELLED,
  VERSION_MISMATCH: EXIT_CODES.VERSION_MISMATCH,
  RESULT_FAILED: EXIT_CODES.RESULT_FAILED,
  INTERNAL: EXIT_CODES.ERROR,
};

export interface CliErrorOptions {
  /** Shown under the message as "try this" guidance. */
  hint?: string;
  /** Concrete next commands, rendered verbatim. */
  suggestions?: string[];
  /** Machine detail included in `--json` output. */
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly hint: string | undefined;
  readonly suggestions: string[];
  readonly details: Record<string, unknown> | undefined;

  constructor(code: CliErrorCode, message: string, options: CliErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CliError';
    this.code = code;
    this.hint = options.hint;
    this.suggestions = options.suggestions ?? [];
    this.details = options.details;
  }

  get exitCode(): ExitCode {
    return EXIT_BY_CODE[this.code];
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      ...(this.hint ? { hint: this.hint } : {}),
      ...(this.suggestions.length ? { suggestions: this.suggestions } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }

  static usage(message: string, options?: CliErrorOptions): CliError {
    return new CliError('USAGE', message, options);
  }

  static notFound(what: string, ref: string, options?: CliErrorOptions): CliError {
    return new CliError('NOT_FOUND', `No ${what} matches "${ref}".`, options);
  }

  static internal(message: string, cause?: unknown): CliError {
    return new CliError('INTERNAL', message, { cause });
  }
}

/**
 * Maps an arbitrary thrown value onto a `CliError`.
 *
 * `ApiError` from client-core is matched structurally rather than with
 * `instanceof`: the CLI can hold two copies of client-core in a pnpm
 * workspace during a partial install, and an `instanceof` miss there would
 * downgrade a clean 403 into an opaque INTERNAL.
 */
export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;

  const api = error as { status?: unknown; path?: unknown; message?: unknown } | null;
  if (api && typeof api.status === 'number' && typeof api.path === 'string') {
    const message = typeof api.message === 'string' ? api.message : `Request failed (${api.status})`;
    switch (api.status) {
      case 400:
      case 422:
        return new CliError('VALIDATION', message, { details: { path: api.path } });
      case 401:
        return new CliError('NOAUTH', message, {
          hint: 'This device is not paired with the server, or its credential was revoked.',
          suggestions: ['generatorai device status', 'generatorai device pair <code>'],
        });
      case 403:
        return new CliError('FORBIDDEN', message, {
          hint: 'The device is paired but lacks the required scope.',
          suggestions: ['generatorai device status'],
        });
      case 404:
        return new CliError('NOT_FOUND', message, { details: { path: api.path } });
      case 409:
        return new CliError('CONFLICT', message, { details: { path: api.path } });
      case 503:
        return new CliError('UNAVAILABLE', message, { details: { path: api.path } });
      default:
        return new CliError('INTERNAL', message, { details: { path: api.path, status: api.status } });
    }
  }

  // Node's fetch surfaces every connection failure as a bare TypeError whose
  // message is the useless "fetch failed"; the cause carries the real code.
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  const netCode = cause?.code;
  if (netCode === 'ECONNREFUSED' || netCode === 'ENOTFOUND' || netCode === 'EHOSTUNREACH') {
    return new CliError('UNAVAILABLE', `Could not reach the server (${netCode}).`, {
      hint: 'Is the server running, and is the URL right?',
      suggestions: ['generatorai connect list', 'generatorai connect test', 'pnpm dev:server'],
    });
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return new CliError('CANCELLED', 'Operation cancelled.');
  }

  return CliError.internal(error instanceof Error ? error.message : String(error), error);
}
