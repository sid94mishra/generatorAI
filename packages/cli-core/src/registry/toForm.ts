// ────────────────────────────────────────────────────────────────
// Command specs → form fields.
//
// The sixth derivation from `CommandSpec` (after commander, completions,
// palette, RPC and docs): a fillable form.
//
// This exists because the palette could not run a large slice of the
// registry. `runFromPalette` collected REQUIRED ARGUMENTS one at a time
// through chained single-line prompts, and refused outright — "This command
// needs options the palette cannot collect yet" — the moment a spec had a
// required FLAG. `workflow stage add`, `review create`, `automation create`
// and every other authoring command lands in that refusal, which is why
// workflow authoring had no terminal-native surface at all.
//
// Nothing here renders: this module turns a spec into field descriptors and
// turns filled-in descriptors back into the `{args, flags}` pair `validate()`
// already expects, so both directions are unit-testable without mounting a
// terminal. The overlay that paints them lives in `apps/cli/src/tui`.
// ────────────────────────────────────────────────────────────────

import type { CommandSpec } from './CommandSpec.js';

export interface FormField {
  /** The arg/flag name — the key this value lands under in `{args, flags}`. */
  name: string;
  /** Which half of `CommandInput` this belongs to. */
  target: 'arg' | 'flag';
  /** What to show beside the input. */
  label: string;
  description: string;
  /**
   * `enum` is a `string`/`number` field with `choices` — kept as its own
   * type so the overlay can offer a cycle-through-values interaction rather
   * than free text the user could get wrong.
   */
  type: 'string' | 'number' | 'boolean' | 'enum';
  choices?: readonly string[];
  required: boolean;
  /** Repeatable: the raw value is split into an array on submit. */
  variadic: boolean;
  /** Prefilled value, as text. Empty means "not set". */
  initial: string;
}

/**
 * Every input a spec accepts, arguments first (they are positional and read
 * first in the usage line, so a form that reorders them would not match what
 * the docs and `--help` show).
 *
 * Hidden flags are excluded: they exist for deprecated spellings that still
 * parse, and offering one in a form would teach it as current.
 */
export function formFieldsForSpec(
  spec: CommandSpec,
  presets: Record<string, unknown> = {},
): FormField[] {
  const asText = (value: unknown): string => {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
  };

  const argFields: FormField[] = spec.args.map((arg) => ({
    name: arg.name,
    target: 'arg' as const,
    label: arg.name,
    description: arg.unsupported
      ? `${arg.description} — UNSUPPORTED: ${arg.unsupported}`
      : arg.description,
    type: arg.choices?.length ? ('enum' as const) : ('string' as const),
    ...(arg.choices?.length ? { choices: arg.choices } : {}),
    required: arg.required,
    variadic: Boolean(arg.variadic),
    initial: asText(presets[arg.name]),
  }));

  const flagFields: FormField[] = spec.flags
    .filter((flag) => !flag.hidden)
    .map((flag) => ({
      name: flag.name,
      target: 'flag' as const,
      label: `--${flag.name}`,
      // Phase 0 item 1 — an option that is accepted and discarded says so in
      // the form too. A form is the surface where someone MOST expects
      // filling a field in to have had an effect.
      description: flag.unsupported
        ? `${flag.description} — UNSUPPORTED: ${flag.unsupported}`
        : flag.description,
      type: flag.choices?.length
        ? ('enum' as const)
        : flag.type === 'boolean'
          ? ('boolean' as const)
          : flag.type === 'number'
            ? ('number' as const)
            : ('string' as const),
      ...(flag.choices?.length ? { choices: flag.choices } : {}),
      required: Boolean(flag.required),
      variadic: Boolean(flag.variadic),
      // A preset beats the spec's own default: the caller knows something
      // the spec cannot (which workflow this pane is showing, say).
      initial:
        presets[flag.name] !== undefined ? asText(presets[flag.name]) : asText(flag.default),
    }));

  return [...argFields, ...flagFields];
}

/** A spec worth showing a form for at all — one with nothing to fill in should just run. */
export function specNeedsForm(spec: CommandSpec): boolean {
  return spec.args.length > 0 || spec.flags.some((flag) => !flag.hidden);
}

/** Fields left empty that the spec says are required — checked before submitting, not after a 400. */
export function missingRequiredFields(
  fields: FormField[],
  values: Record<string, string>,
): FormField[] {
  return fields.filter(
    (field) => field.required && field.type !== 'boolean' && !(values[fieldKey(field)] ?? '').trim(),
  );
}

/**
 * Unique per field across both halves — an arg and a flag may legitimately
 * share a name (`workspace` is a positional arg on `review create` and a
 * flag elsewhere), so keying values by bare name alone would collide.
 */
export function fieldKey(field: FormField): string {
  return `${field.target}:${field.name}`;
}

/**
 * Filled-in fields → the `{args, flags}` pair `validate()` takes.
 *
 * An empty optional field is OMITTED rather than sent as `''`: several
 * server schemas treat an empty string as a real value (a blank commit
 * message, a blank PR title) where absence means "don't set this".
 */
export function formValuesToInput(
  fields: FormField[],
  values: Record<string, string>,
): { args: Record<string, unknown>; flags: Record<string, unknown> } {
  const args: Record<string, unknown> = {};
  const flags: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = (values[fieldKey(field)] ?? '').trim();
    const bucket = field.target === 'arg' ? args : flags;

    if (field.type === 'boolean') {
      // An OPTIONAL boolean is only sent when actually turned on: sending
      // `false` is not the same as leaving it out for a schema whose default
      // is `true`, and "off" is what absence already means.
      //
      // A REQUIRED one is always sent, both values. There is no such flag in
      // the registry today, but omitting it would fail validation on a field
      // the form showed as answered — the exact "your input was discarded"
      // failure the form exists to prevent.
      if (field.required) bucket[field.name] = raw === 'true';
      else if (raw === 'true') bucket[field.name] = true;
      continue;
    }

    if (!raw) continue;

    if (field.variadic) {
      // Comma OR whitespace: a user typing a path list naturally reaches
      // for one or the other, and neither is valid inside the values these
      // flags take (ids, aliases, paths without spaces).
      bucket[field.name] = raw
        .split(/[,\s]+/)
        .map((part) => part.trim())
        .filter(Boolean);
      continue;
    }

    if (field.type === 'number') {
      const parsed = Number(raw);
      // Left as text when it isn't a number at all — the spec's own zod
      // schema produces a far better message than a silent `NaN` would.
      bucket[field.name] = Number.isFinite(parsed) ? parsed : raw;
      continue;
    }

    bucket[field.name] = raw;
  }

  return { args, flags };
}
