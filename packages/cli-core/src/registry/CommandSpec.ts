// ────────────────────────────────────────────────────────────────
// CommandSpec — the single declaration of a CLI capability.
//
// Everything the user can invoke is described once, here, as data. Five
// consumers are DERIVED from that declaration and can therefore never drift
// from it or from each other:
//
//   registry/toCommander.ts    the scriptable binary
//   registry/toCompletions.ts  bash / zsh / fish / pwsh / nushell
//   registry/toPalette.ts      the TUI command palette
//   registry/toRpcMethods.ts   companion-mode method table
//   registry/toDocs.ts         the tables in .github/docs/usage-cli.md
//
// The previous CLI hand-wrote the first two and hand-wrote the docs, and all
// three had already diverged: `completions.ts` listed commands that no longer
// existed and usage-cli.md documented `run messages` and `from-template`,
// neither of which was implemented. Deriving them is the fix.
// ────────────────────────────────────────────────────────────────

import type { z } from 'zod';
import type { CliContext } from '../context/CliContext.js';

/** How a value is presented when the renderer is not `--json`. */
export type ColumnFormat =
  | 'text'
  | 'id'
  | 'status'
  | 'date'
  | 'relative'
  | 'duration'
  | 'bytes'
  | 'number'
  | 'boolean'
  | 'list';

export interface ColumnSpec {
  /** Dot-path into the row object, e.g. `definition.name`. */
  key: string;
  header: string;
  format?: ColumnFormat;
  /** Lower numbers are dropped first when the terminal is narrow. 0 = never drop. */
  priority?: number;
  width?: number;
  align?: 'left' | 'right';
}

export type OutputKind =
  /** A single entity: rendered as a key/value block. */
  | 'record'
  /** An array of entities: rendered as a table. */
  | 'list'
  /** Long-lived; the handler drives `ctx.emit` and resolves when finished. */
  | 'stream'
  /** Nothing to print beyond a success line. */
  | 'void'
  /** Pre-rendered text (diffs, exports, file contents) — printed verbatim. */
  | 'raw';

export interface OutputSpec {
  kind: OutputKind;
  columns?: ColumnSpec[];
  /** Key/value order for `record`; unlisted keys follow in insertion order. */
  fields?: ColumnSpec[];
  /** Human line printed for `void` results. Supports `{field}` interpolation. */
  successMessage?: string;
  /** For `list`: dot-path to the array when the payload is an envelope. */
  itemsAt?: string;
}

export interface CommandArg {
  name: string;
  description: string;
  required: boolean;
  variadic?: boolean;
  /** What this argument refers to, so completions can query the server for ids. */
  completes?: CompletionSource;
}

export type CompletionSource =
  | 'chat'
  | 'agent'
  | 'workflow'
  | 'run'
  | 'stage'
  | 'automation'
  | 'project'
  | 'codebase'
  | 'workspace'
  | 'script'
  | 'template'
  | 'extension'
  | 'widget'
  | 'connection'
  | 'profile'
  | 'model'
  | 'theme'
  | 'file'
  | 'directory'
  | 'shell';

export interface CommandFlag {
  /** Long name without dashes, camelCase. Rendered as `--kebab-case`. */
  name: string;
  short?: string;
  description: string;
  /** `boolean` flags take no value; `string`/`number` require one. */
  type: 'boolean' | 'string' | 'number';
  /** Repeatable (`--var a=1 --var b=2`). */
  variadic?: boolean;
  required?: boolean;
  default?: string | number | boolean;
  choices?: readonly string[];
  completes?: CompletionSource;
  /** Hidden from help but still accepted — used for deprecated spellings. */
  hidden?: boolean;
}

/** What a handler hands back. Renderers never see anything else. */
export interface CommandResult<T = unknown> {
  data: T;
  /** Non-fatal problems worth showing but not worth failing over. */
  warnings?: string[];
  /** Overrides `output.successMessage` when the handler knows better. */
  message?: string;
  /**
   * Overrides the process exit code on success. Used by commands that report
   * a remote failure state (`run watch` on a failed run) without themselves
   * having failed.
   */
  exitCode?: number;
}

export interface CommandInput<A, F> {
  args: A;
  flags: F;
}

export interface CommandSpec<A = any, F = any, R = any> {
  /** Stable dotted identifier, e.g. `run.start`. Used by the palette and RPC. */
  id: string;
  /** Top-level group, e.g. `run`. */
  group: string;
  /**
   * Space-separated verb path within the group, e.g. `stage pause`.
   * Empty string means the command IS the group (`generatorai tui`).
   */
  verb: string;
  aliases?: string[];
  summary: string;
  description?: string;
  examples?: string[];

  args: CommandArg[];
  flags: CommandFlag[];
  /**
   * Zod schema validating the parsed `{ args, flags }` pair.
   *
   * The input position is pinned to `unknown` deliberately. Left open, TS
   * infers `A`/`F` from the schema's INPUT type as well as its output, and a
   * `.default()` — optional on the way in, guaranteed on the way out — comes
   * back as `T | undefined` in every handler, forcing a `?? default` at each
   * use that the schema already promised to supply.
   */
  schema?: z.ZodType<CommandInput<A, F>, z.ZodTypeDef, unknown>;

  /** Device scopes the server will require. Surfaced in `--help` and pre-checked. */
  scopes?: string[];
  /** False for commands that work with no server (`config`, `device pair`). */
  requiresServer: boolean;
  /** Forces a confirmation prompt unless `--yes` or `--json`. */
  destructive?: boolean;
  /** Excluded from help, completions and the palette. */
  hidden?: boolean;
  /** Present in the palette (TUI) — defaults to true for non-hidden commands. */
  inPalette?: boolean;
  /** Exposed over companion RPC — defaults to true for non-hidden commands. */
  inRpc?: boolean;
  /** Semver of the CLI in which this command first appeared. */
  sinceVersion: string;
  /** Set when an older spelling still resolves here. */
  deprecates?: string[];

  output: OutputSpec;
  handler(ctx: CliContext, input: CommandInput<A, F>): Promise<CommandResult<R>>;
}

/** Narrow helper so `defineCommand` infers arg/flag types from the schema. */
export function defineCommand<A, F, R>(spec: CommandSpec<A, F, R>): CommandSpec<A, F, R> {
  return spec;
}

/** `run.start` → `run start`; used for help, docs and error messages. */
export function commandPath(spec: Pick<CommandSpec, 'group' | 'verb'>): string {
  return spec.verb ? `${spec.group} ${spec.verb}` : spec.group;
}

/** `variables` → `--variables`; `apiKey` → `--api-key`. */
export function flagToCli(name: string): string {
  return `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** Full usage line: `run start <definitionId> [--var <key=value>]`. */
export function usageLine(spec: CommandSpec): string {
  const parts = [commandPath(spec)];
  for (const arg of spec.args) {
    const inner = arg.variadic ? `${arg.name}...` : arg.name;
    parts.push(arg.required ? `<${inner}>` : `[${inner}]`);
  }
  if (spec.flags.some((f) => !f.hidden)) parts.push('[options]');
  return parts.join(' ');
}
