// ────────────────────────────────────────────────────────────────
// Table-driven command-contract suite (audit §12, Phase 1 item 7 /
// §13 "Pure and hermetic").
//
// Runs EVERY registered command's schema and handler against one shared
// fake transport, rather than hand-writing a fixture per command. This is
// deliberately shallow and complements, not replaces, the per-command tests
// elsewhere in this directory:
//
//   - The fake API returns `[]` from every method. Any `resolveRef` lookup
//     against an empty candidate list throws a `CliError.notFound` — so a
//     handler that starts by resolving an id/name argument stops there, and
//     this suite never reaches whatever comes after. That is fine: this
//     suite's job is to catch a handler that crashes on the FIRST step
//     (wrong property path, a typo'd `ctx.apiWorkspaces`, destructuring that
//     assumes a shape `[]` doesn't have) — the specific per-command tests
//     already cover deeper wire-contract correctness for the commands the
//     audit flagged.
//   - "Crash" here means anything that is not a `CliError`. A `CliError` is
//     the command correctly refusing bad/missing input; a raw `TypeError`/
//     `ReferenceError` is exactly the class of bug this whole audit found by
//     hand (wrong field access, calling a method that does not exist).
// ────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRegistry } from '../index.js';
import { CliContext, type Api } from '../../context/CliContext.js';
import { CliError } from '../../errors/CliError.js';
import { DEFAULT_CONFIG } from '../../config/schema.js';
import { detectTerminal } from '../../capabilities/TerminalCapabilities.js';
import type { CommandSpec } from '../../registry/CommandSpec.js';

/**
 * Every property access yields another instance of itself (so
 * `ctx.api.a.b.c(...)` chains through any depth), and calling it resolves to
 * an empty array — the most permissive value in JS: safe to index, iterate,
 * `.map`/`.length`, or read a property off (`undefined`) without throwing.
 */
function deepStub(): unknown {
  const fn = async (..._args: unknown[]): Promise<unknown[]> => [];
  return new Proxy(fn, {
    get(target, prop, receiver) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally' || typeof prop === 'symbol') {
        return Reflect.get(target, prop, receiver);
      }
      return deepStub();
    },
  });
}

/**
 * Point the whole CLI at a throwaway identity for the duration of this file.
 *
 * The API is stubbed, but the LOCAL filesystem is not: this suite invokes
 * EVERY registered handler, and some of them work on disk rather than over
 * the wire. `device forget` is the sharp one — it opens the credential vault
 * at `getUserConfigDir()` and deletes the entry. With no override that is the
 * developer's real `~/.generatorai`, so running the test suite silently
 * signed them out of their CLI: the vault went from 1,663 bytes to 48
 * (`{"entries":{}}`) and `device status` reported `unpaired`. It cost two
 * re-pairings to notice, because nothing fails — the damage is to a file no
 * assertion looks at.
 *
 * `getUserConfigDir()` reads the variable on every call, so setting it here
 * covers every handler this file reaches.
 */
let configDir: string | undefined;
let previousConfigDir: string | undefined;
let previousRegistryDir: string | undefined;

beforeAll(() => {
  configDir = mkdtempSync(join(tmpdir(), 'gai-cli-contract-'));
  previousConfigDir = process.env['GENERATORAI_CONFIG_DIR'];
  previousRegistryDir = process.env['GENERATORAI_CHILD_REGISTRY_DIR'];
  process.env['GENERATORAI_CONFIG_DIR'] = configDir;
  // Same story, smaller blast radius: the child registry defaults into
  // `~/.generatorai/children`.
  process.env['GENERATORAI_CHILD_REGISTRY_DIR'] = join(configDir, 'children');
});

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env['GENERATORAI_CONFIG_DIR'];
  else process.env['GENERATORAI_CONFIG_DIR'] = previousConfigDir;
  if (previousRegistryDir === undefined) delete process.env['GENERATORAI_CHILD_REGISTRY_DIR'];
  else process.env['GENERATORAI_CHILD_REGISTRY_DIR'] = previousRegistryDir;
  if (configDir) rmSync(configDir, { recursive: true, force: true });
});

function fakeCtx(): CliContext {
  return new CliContext({
    api: deepStub() as Api,
    config: { ...DEFAULT_CONFIG, sources: { user: null, project: null, env: [], flags: [] } },
    connection: null,
    capabilities: detectTerminal({}),
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    prompt: {
      confirm: async (_message, defaultValue) => defaultValue,
      text: async (_message, defaultValue) => defaultValue ?? '',
      select: async (_message, choices) => choices[0] as never,
      password: async () => {
        throw new Error('This contract suite never collects secrets.');
      },
    },
    stream: { subscribe: () => () => {} },
    terminalAttach: {
      attach: async () => {
        throw new Error('Raw terminal attach is not stubbed in this contract suite.');
      },
    },
    emit: () => {},
    signal: new AbortController().signal,
    interactive: false,
    assumeYes: true,
    verbose: false,
    timeoutMs: 5000,
    fetch: async () => {
      throw new Error('Raw fetch is not stubbed in this contract suite.');
    },
    baseUrl: 'http://127.0.0.1:3100',
  });
}

// Some string args/flags carry a format constraint their `CommandArg`/
// `CommandFlag` declaration doesn't expose to this generic harness (a Zod
// `.url()`, for instance) — the only one both a URL *and* a plain string
// schema will accept. Not `'placeholder'`: a bare word is a valid generic
// string but not a valid URL, which is what actually failed here for
// `connect.add`, `connect.endpoint.add` and `webhook.create`.
const PLACEHOLDER_STRING = 'https://example.com';

function plausibleArgs(spec: CommandSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const arg of spec.args) {
    if (!arg.required) continue;
    const base = arg.choices?.length ? arg.choices[0] : PLACEHOLDER_STRING;
    out[arg.name] = arg.variadic ? [base] : base;
  }
  return out;
}

function plausibleFlags(spec: CommandSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const flag of spec.flags) {
    if (flag.default !== undefined) {
      out[flag.name] = flag.default;
      continue;
    }
    if (!flag.required) continue;
    const base: unknown = flag.choices?.length
      ? flag.choices[0]
      : flag.type === 'number'
        ? 1
        : flag.type === 'boolean'
          ? true
          : PLACEHOLDER_STRING;
    out[flag.name] = flag.variadic ? [base] : base;
  }
  return out;
}

const registry = buildRegistry({ version: '0.0.0-test' });
const specs = registry.all();

describe('command registry contract', () => {
  it('registers a real, non-trivial command surface', () => {
    // A regression guard on its own: if `buildRegistry()` starts throwing
    // (duplicate id/path) or silently drops a group, this fails loudly
    // instead of every test below quietly iterating over nothing.
    expect(specs.length).toBeGreaterThan(150);
  });

  describe.each(specs.map((spec) => [spec.id, spec] as const))(
    '%s',
    (_id, spec) => {
      it('schema accepts a minimal input built from its own declared args/flags', () => {
        if (!spec.schema) return;
        const input = { args: plausibleArgs(spec), flags: plausibleFlags(spec) };
        const result = spec.schema.safeParse(input);
        expect(
          result.success,
          result.success ? undefined : JSON.stringify(result.error.issues, null, 2),
        ).toBe(true);
      });

      it('handler either succeeds or throws a CliError — never a raw crash', async () => {
        const input = { args: plausibleArgs(spec), flags: plausibleFlags(spec) };
        const parsed = spec.schema?.safeParse(input);
        // Already reported by the schema test above; do not double-count it
        // here as a handler crash.
        if (parsed && !parsed.success) return;
        const validated = (parsed?.success ? parsed.data : input) as never;

        const ctx = fakeCtx();
        try {
          await spec.handler(ctx, validated);
        } catch (error) {
          if (error instanceof CliError) return;
          throw error instanceof Error
            ? error
            : new Error(`${spec.id} threw a non-Error value: ${String(error)}`);
        } finally {
          await ctx.dispose();
        }
      });
    },
  );
});
