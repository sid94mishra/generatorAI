// ────────────────────────────────────────────────────────────────
// The false-success gate (Phase 0 item 1).
//
// The audit's Phase 0 opens with "mark false-success options and commands as
// experimental or unsupported immediately", and §5.4 is titled "advertised
// options and commands silently do less than requested". The failure is
// always the same: an option parses, validates, and is then discarded — and
// the user gets exit code 0 for work that never happened.
//
// `CommandFlag.unsupported` is the marking. These tests are what stop it from
// being forgotten on the NEXT such option: an option cannot describe itself
// as inert in prose without also being marked, and a marked one must actually
// reach every derived surface.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../index.js';
import { z } from 'zod';
import { toDocs, toRpcMethods } from '../../registry/generators.js';
import { defineCommand } from '../../registry/CommandSpec.js';
import { CommandRegistry } from '../../registry/registry.js';
import { RUN_GROUP } from '../run.js';
import { inputSchema, ok } from '../_shared.js';

const registry = buildRegistry();
const allFlags = registry.all().flatMap((spec) => spec.flags.map((flag) => ({ spec, flag })));

/**
 * A registry with one command whose option is marked: the real registry may
 * legitimately have none, and the "carries the marking" checks below must
 * still prove something.
 */
const markedRegistry = new CommandRegistry().declareGroup(RUN_GROUP);
markedRegistry.register(
  defineCommand({
    id: 'run.fixture',
    group: 'run',
    verb: 'fixture',
    summary: 'Fixture with a marked option',
    requiresServer: false,
    sinceVersion: '0.2.0',
    args: [],
    flags: [
      {
        name: 'inert',
        description: 'An option the fixture accepts',
        type: 'string',
        unsupported: 'The fixture accepts this value and discards it, on purpose.',
      },
    ],
    schema: inputSchema({}, { inert: z.string().optional() }),
    output: { kind: 'void' },
    async handler() {
      return ok('done');
    },
  }),
);
const markedFlags = markedRegistry.all().flatMap((spec) => spec.flags.map((flag) => ({ spec, flag })));

/**
 * Phrases that mean "this does not do what it says".
 *
 * Matched against the DESCRIPTION only. The point is that prose is not a
 * marking — a reader of `--help` may notice it, but the generated docs, the
 * RPC descriptors and the schema-driven form cannot act on it.
 */
const INERT_PHRASES = [
  'no effect',
  'not supported',
  'unsupported',
  'is ignored',
  'are ignored',
  'silently ignored',
  'does nothing',
  'not implemented',
  'placeholder',
];

describe('false-success marking', () => {
  it('never describes an option as inert without marking it', () => {
    const unmarked = allFlags
      .filter(({ flag }) => !flag.unsupported)
      .filter(({ flag }) => {
        const text = flag.description.toLowerCase();
        return INERT_PHRASES.some((phrase) => text.includes(phrase));
      })
      .map(({ spec, flag }) => `${spec.id} --${flag.name}`);

    expect(
      unmarked,
      'these options describe themselves as inert but are not marked `unsupported`',
    ).toEqual([]);
  });

  it('gives every marked option a reason, not just a label', () => {
    // "UNSUPPORTED" alone tells the user nothing about whether to stop using
    // it, work around it, or wait for a server change.
    for (const { spec, flag } of allFlags) {
      if (!flag.unsupported) continue;
      expect(flag.unsupported.length, `${spec.id} --${flag.name}`).toBeGreaterThan(20);
    }
  });

  it('never marks an option that is also required', () => {
    // Requiring a value the command then discards is a contradiction the
    // user cannot satisfy.
    for (const { spec, flag } of allFlags) {
      if (!flag.unsupported) continue;
      expect(flag.required, `${spec.id} --${flag.name} is required AND unsupported`).toBeFalsy();
    }
  });

  it('carries the marking into the generated docs', () => {
    const marked = markedFlags.filter(({ flag }) => flag.unsupported);
    // Guards the guard: if nothing is marked, the two assertions below pass
    // vacuously and this test proves nothing.
    expect(marked.length).toBeGreaterThan(0);

    const docs = toDocs(markedRegistry);
    for (const { flag } of marked) {
      expect(docs).toContain(flag.unsupported!);
    }
  });

  it('carries the marking into the RPC method descriptors', () => {
    const marked = markedFlags.filter(({ flag }) => flag.unsupported);
    const methods = JSON.stringify(toRpcMethods(markedRegistry));
    for (const { flag } of marked) {
      expect(methods).toContain(flag.unsupported!);
    }
  });

  it('keeps accepting a marked option, so existing scripts still parse', () => {
    // Removing it outright would break callers that already pass it. The
    // contract is "accepted and honestly labelled", not "rejected".
    for (const { spec, flag } of markedFlags) {
      if (!flag.unsupported || !spec.schema) continue;
      const result = spec.schema.safeParse({
        args: Object.fromEntries(spec.args.filter((a) => a.required).map((a) => [a.name, 'x'])),
        flags: { [flag.name]: flag.type === 'boolean' ? true : flag.type === 'number' ? 1 : 'x' },
      });
      // A schema may reject for an unrelated missing required flag; what must
      // never happen is a rejection naming THIS flag.
      if (!result.success) {
        const paths = result.error.issues.map((issue) => issue.path.join('.'));
        expect(paths, `${spec.id} rejects its own --${flag.name}`).not.toContain(`flags.${flag.name}`);
      }
    }
  });
});
