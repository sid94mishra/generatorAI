// ────────────────────────────────────────────────────────────────
// Spec → form field derivation.
//
// The behaviour that matters here is round-tripping: fields derived from a
// spec, filled in, and converted back must produce an `{args, flags}` pair
// the spec's own zod schema accepts. A form that produces `''` where the
// schema wants "absent", or a string where it wants a number, fails
// validation with a message the user did not cause — which is exactly the
// class of bug the palette's old chained-prompt collection had.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand, type CommandSpec } from '../CommandSpec.js';
import {
  fieldKey,
  formFieldsForSpec,
  formValuesToInput,
  missingRequiredFields,
  specNeedsForm,
} from '../toForm.js';

const spec: CommandSpec = defineCommand({
  id: 'demo.thing',
  group: 'demo',
  verb: 'thing',
  summary: 'A demo command',
  requiresServer: true,
  sinceVersion: '0.2.0',
  args: [
    { name: 'workspace', description: 'Workspace reference', required: true },
    { name: 'note', description: 'Optional note', required: false },
  ],
  flags: [
    { name: 'startLine', description: 'First line', type: 'number', required: true },
    { name: 'side', description: 'Diff side', type: 'string', choices: ['additions', 'deletions'] as const, default: 'additions' },
    { name: 'draft', description: 'Open as draft', type: 'boolean' },
    { name: 'path', description: 'Paths (repeatable)', type: 'string', variadic: true },
    { name: 'legacy', description: 'Old spelling', type: 'string', hidden: true },
  ],
  schema: z.object({
    args: z.object({ workspace: z.string(), note: z.string().optional() }),
    flags: z.object({
      startLine: z.coerce.number().int().positive(),
      side: z.enum(['additions', 'deletions']).default('additions'),
      draft: z.boolean().optional(),
      path: z.array(z.string()).optional(),
    }),
  }),
  output: { kind: 'record' },
  async handler() {
    return { data: null };
  },
});

const valuesFor = (fields: ReturnType<typeof formFieldsForSpec>): Record<string, string> =>
  Object.fromEntries(fields.map((f) => [fieldKey(f), f.initial]));

describe('formFieldsForSpec', () => {
  it('lists arguments before flags, in declaration order', () => {
    const fields = formFieldsForSpec(spec);
    expect(fields.map((f) => f.label)).toEqual([
      'workspace',
      'note',
      '--startLine',
      '--side',
      '--draft',
      '--path',
    ]);
  });

  it('excludes hidden flags — they are deprecated spellings, not current options', () => {
    expect(formFieldsForSpec(spec).some((f) => f.name === 'legacy')).toBe(false);
  });

  it('classifies types from the spec, treating a choices list as an enum', () => {
    const byName = new Map(formFieldsForSpec(spec).map((f) => [f.name, f]));
    expect(byName.get('startLine')?.type).toBe('number');
    expect(byName.get('draft')?.type).toBe('boolean');
    expect(byName.get('side')?.type).toBe('enum');
    expect(byName.get('side')?.choices).toEqual(['additions', 'deletions']);
    expect(byName.get('workspace')?.type).toBe('string');
  });

  it('prefills a flag default, and lets a caller preset beat it', () => {
    const plain = formFieldsForSpec(spec);
    expect(plain.find((f) => f.name === 'side')?.initial).toBe('additions');

    const preset = formFieldsForSpec(spec, { side: 'deletions', workspace: 'ws-1' });
    expect(preset.find((f) => f.name === 'side')?.initial).toBe('deletions');
    expect(preset.find((f) => f.name === 'workspace')?.initial).toBe('ws-1');
  });

  it('renders an array preset as a comma list, matching how it is parsed back', () => {
    const fields = formFieldsForSpec(spec, { path: ['a.ts', 'b.ts'] });
    const initial = fields.find((f) => f.name === 'path')!.initial;
    expect(initial).toBe('a.ts, b.ts');
    // Round-trips through the parser it will actually be read by.
    const { flags } = formValuesToInput(fields, { ...valuesFor(fields) });
    expect(flags['path']).toEqual(['a.ts', 'b.ts']);
  });

  it('keys an arg and a flag of the same name apart', () => {
    // `review create` genuinely has `workspace` as a positional arg while
    // other commands take it as a flag; a bare-name key would collide.
    const argField = { name: 'x', target: 'arg' as const, label: 'x', description: '', type: 'string' as const, required: true, variadic: false, initial: '' };
    const flagField = { ...argField, target: 'flag' as const };
    expect(fieldKey(argField)).not.toBe(fieldKey(flagField));
  });
});

describe('specNeedsForm', () => {
  it('is true when the spec takes anything at all', () => {
    expect(specNeedsForm(spec)).toBe(true);
  });

  it('is false for a command with no args and no visible flags', () => {
    const bare: CommandSpec = { ...spec, args: [], flags: [{ ...spec.flags[4]! }] };
    expect(specNeedsForm(bare)).toBe(false);
  });
});

describe('formValuesToInput', () => {
  const fields = formFieldsForSpec(spec);
  const key = (name: string): string => fieldKey(fields.find((f) => f.name === name)!);

  it('produces a payload the spec schema accepts', () => {
    const { args, flags } = formValuesToInput(fields, {
      ...valuesFor(fields),
      [key('workspace')]: 'ws-1',
      [key('startLine')]: '12',
    });

    expect(args).toEqual({ workspace: 'ws-1' });
    expect(flags).toEqual({ startLine: 12, side: 'additions' });
    expect(() => spec.schema!.parse({ args, flags })).not.toThrow();
  });

  it('omits an empty optional field rather than sending an empty string', () => {
    // A blank commit message / PR title is a real value to several server
    // schemas; absence is what "leave it alone" means.
    const { args } = formValuesToInput(fields, {
      ...valuesFor(fields),
      [key('workspace')]: 'ws-1',
      [key('note')]: '   ',
    });
    expect('note' in args).toBe(false);
  });

  it('sends a boolean only when it is on', () => {
    const base = { ...valuesFor(fields), [key('workspace')]: 'ws-1', [key('startLine')]: '1' };
    expect(formValuesToInput(fields, base).flags['draft']).toBeUndefined();
    expect(formValuesToInput(fields, { ...base, [key('draft')]: 'true' }).flags['draft']).toBe(true);
    // Explicitly "off" is still absent, not `false`: a schema whose default
    // is `true` would be silently overridden by sending `false`.
    expect(formValuesToInput(fields, { ...base, [key('draft')]: 'false' }).flags['draft']).toBeUndefined();
  });

  it('splits a variadic field on commas or whitespace', () => {
    const base = { ...valuesFor(fields), [key('workspace')]: 'ws-1', [key('startLine')]: '1' };
    expect(formValuesToInput(fields, { ...base, [key('path')]: 'a.ts, b.ts' }).flags['path']).toEqual(['a.ts', 'b.ts']);
    expect(formValuesToInput(fields, { ...base, [key('path')]: 'a.ts b.ts' }).flags['path']).toEqual(['a.ts', 'b.ts']);
  });

  it('leaves an unparseable number as text so the schema reports it, not NaN', () => {
    const { flags } = formValuesToInput(fields, {
      ...valuesFor(fields),
      [key('workspace')]: 'ws-1',
      [key('startLine')]: 'abc',
    });
    expect(flags['startLine']).toBe('abc');
  });
});

describe('missingRequiredFields', () => {
  const fields = formFieldsForSpec(spec);
  const key = (name: string): string => fieldKey(fields.find((f) => f.name === name)!);

  it('names every empty required field, args and flags alike', () => {
    const missing = missingRequiredFields(fields, valuesFor(fields));
    expect(missing.map((f) => f.name)).toEqual(['workspace', 'startLine']);
  });

  it('is satisfied once they are filled', () => {
    expect(
      missingRequiredFields(fields, {
        ...valuesFor(fields),
        [key('workspace')]: 'ws-1',
        [key('startLine')]: '3',
      }),
    ).toEqual([]);
  });

  it('always sends a REQUIRED boolean, both values', () => {
    // There is no such flag in the registry today. If one is added,
    // omitting `false` would fail validation on a field the form showed as
    // answered — the "your input was discarded" failure the form exists to
    // prevent.
    const boolSpec: CommandSpec = {
      ...spec,
      args: [],
      flags: [
        { name: 'force', description: 'Force', type: 'boolean', required: true },
        { name: 'quiet', description: 'Quiet', type: 'boolean' },
      ],
    };
    const boolFields = formFieldsForSpec(boolSpec);
    const key = (name: string): string => fieldKey(boolFields.find((f) => f.name === name)!);

    expect(formValuesToInput(boolFields, valuesFor(boolFields)).flags).toEqual({ force: false });
    expect(
      formValuesToInput(boolFields, { ...valuesFor(boolFields), [key('force')]: 'true' }).flags,
    ).toEqual({ force: true });
    // The optional one is still omitted when off.
    expect(
      formValuesToInput(boolFields, { ...valuesFor(boolFields), [key('quiet')]: 'false' }).flags,
    ).toEqual({ force: false });
  });

  it('never reports a boolean as missing — "off" is a complete answer', () => {
    const boolSpec: CommandSpec = {
      ...spec,
      args: [],
      flags: [{ name: 'force', description: 'Force', type: 'boolean', required: true }],
    };
    const boolFields = formFieldsForSpec(boolSpec);
    expect(missingRequiredFields(boolFields, valuesFor(boolFields))).toEqual([]);
  });
});
