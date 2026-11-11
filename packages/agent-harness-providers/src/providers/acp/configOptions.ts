// ────────────────────────────────────────────────────────────────
// ACP session config options → GeneratorAI's model catalog (docs/acp ACP-2).
//
// An ACP agent publishes its choices as `configOptions` (spec: session config
// options, stable since v0.10.8) on `session/new` / `load` / `resume`, on the
// unstable `session/options`, in every `session/set_config_option` answer and
// in `config_option_update`. Each is a `select` (flat or grouped options) or a
// `boolean`, with an optional `category`: `model`, `thought_level` (effort),
// `mode`, `model_config` or a custom one. "Categories … MUST NOT be required
// for correctness" and the array order is the agent's priority, so the first
// option of a category wins, and an option whose id is the category's name
// stands in when the agent sent no category at all.
//
// Pure: no SDK import (the types are structural), so this is unit-testable and
// loads without `@agentclientprotocol/sdk` (W41).
// ────────────────────────────────────────────────────────────────

import type { HarnessModel } from '@generatorai/core';

/** Structural copy of the SDK's `SessionConfigSelectOption`. */
export interface AcpSelectValue {
  value: string;
  name: string;
  description?: string | null;
}

/** Structural copy of the SDK's `SessionConfigSelectGroup`. */
export interface AcpSelectGroup {
  group: string;
  name: string;
  options: AcpSelectValue[];
}

/** Structural copy of the SDK's `SessionConfigOption` (select | boolean). */
export type AcpConfigOption =
  | {
      type: 'select';
      id: string;
      name: string;
      description?: string | null;
      category?: string | null;
      currentValue: string;
      options: AcpSelectValue[] | AcpSelectGroup[];
    }
  | {
      type: 'boolean';
      id: string;
      name: string;
      description?: string | null;
      category?: string | null;
      currentValue: boolean;
    };

export type AcpSelectOption = Extract<AcpConfigOption, { type: 'select' }>;

/** A select value with the label of the group it was listed under, if any. */
export interface AcpFlatValue extends AcpSelectValue {
  groupName?: string;
}

function isGroup(o: AcpSelectValue | AcpSelectGroup): o is AcpSelectGroup {
  return Array.isArray((o as AcpSelectGroup).options);
}

/** Every value of a select, groups flattened in order. */
export function flattenSelectValues(option: AcpSelectOption): AcpFlatValue[] {
  const out: AcpFlatValue[] = [];
  for (const entry of option.options as Array<AcpSelectValue | AcpSelectGroup>) {
    if (isGroup(entry)) {
      for (const v of entry.options) out.push({ ...v, groupName: entry.name });
    } else {
      out.push(entry);
    }
  }
  return out;
}

/**
 * The first select of `category` (array order is the agent's priority); without one, a select whose id is the
 * category name (`model`, `mode`) — categories are optional in the spec.
 */
export function findSelectOption(
  options: readonly AcpConfigOption[] | null | undefined,
  category: 'model' | 'thought_level' | 'mode',
): AcpSelectOption | undefined {
  const selects = (options ?? []).filter((o): o is AcpSelectOption => o.type === 'select');
  const byCategory = selects.find((o) => o.category === category);
  if (byCategory) return byCategory;
  const fallbackIds = category === 'thought_level' ? ['thought_level', 'effort', 'reasoning_effort'] : [category];
  return selects.find((o) => !o.category && fallbackIds.includes(o.id));
}

export interface ConfigOptionsToModelsOptions {
  /** The agent's display name, for the single "agent's default model" entry. */
  agentLabel: string;
}

/**
 * The agent's models as `HarnessModel`s, ids = the option VALUES (the multiplexer prefixes them with the agent id).
 *
 * - The model select's values, groups flattened (`category` = the group's name), the current one `isDefault`.
 * - An agent with no model option offers one model with id `''`: "<Agent> (agent's default model)".
 * - The `thought_level` select applies to the CURRENT model only (its choices depend on the model, per the spec),
 *   so only that entry carries `reasoningEfforts` — another model's levels are not known until it is selected.
 */
export function configOptionsToModels(
  options: readonly AcpConfigOption[] | null | undefined,
  opts: ConfigOptionsToModelsOptions,
): HarnessModel[] {
  const modelOption = findSelectOption(options, 'model');
  const effort = findSelectOption(options, 'thought_level');
  const effortFields = (isCurrent: boolean): Partial<HarnessModel> => {
    if (!isCurrent || !effort) return {};
    const levels = flattenSelectValues(effort).map((v) => v.value);
    if (levels.length === 0) return {};
    return {
      supportsReasoning: true,
      reasoningEfforts: levels,
      ...(levels.includes(effort.currentValue) ? { defaultReasoningEffort: effort.currentValue } : {}),
    };
  };

  if (!modelOption) {
    return [{ id: '', name: `${opts.agentLabel} (agent's default model)`, isDefault: true, ...effortFields(true) }];
  }
  const seen = new Set<string>();
  const models: HarnessModel[] = [];
  for (const v of flattenSelectValues(modelOption)) {
    if (seen.has(v.value)) continue;
    seen.add(v.value);
    const isCurrent = v.value === modelOption.currentValue;
    models.push({
      id: v.value,
      name: v.name || v.value,
      ...(v.description ? { description: v.description } : {}),
      ...(v.groupName ? { category: v.groupName } : {}),
      ...(isCurrent ? { isDefault: true } : {}),
      ...effortFields(isCurrent),
    });
  }
  return models;
}

/** A value accepted by a select, or undefined. Exact match first, then case-insensitive. */
export function matchSelectValue(option: AcpSelectOption, wanted: string): string | undefined {
  const values = flattenSelectValues(option);
  const exact = values.find((v) => v.value === wanted);
  if (exact) return exact.value;
  const lower = wanted.toLowerCase();
  return values.find((v) => v.value.toLowerCase() === lower || v.name.toLowerCase() === lower)?.value;
}

/** The plan-mode value of a `mode` select, if the agent offers one (id or name `plan`). */
export function planModeValue(option: AcpSelectOption | undefined): string | undefined {
  if (!option) return undefined;
  return flattenSelectValues(option).find((v) => v.value.toLowerCase() === 'plan' || /^plan\b/i.test(v.name))?.value;
}
