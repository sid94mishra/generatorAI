// ────────────────────────────────────────────────────────────────
// Turn option models — agent mode, reasoning effort, context tier,
// permission mode. Pure, shared by the composer chips, the options sheet
// and the new-chat sheet, and unit-tested.
// ────────────────────────────────────────────────────────────────

import type { AgentMode, ModelInfo } from '@generatorai/client-core';

import { reasoningEfforts } from '../../../api/modelCatalogue';

export interface OptionModel<T extends string> {
  value: T;
  title: string;
  help: string;
}

export const MODE_OPTIONS: readonly OptionModel<AgentMode>[] = [
  {
    value: 'auto',
    title: 'Auto',
    help: 'The agent works straight through and only stops if it needs you.',
  },
  {
    value: 'plan',
    title: 'Plan first',
    help: 'The agent writes a plan and waits for your approval before making any change.',
  },
];

export const EFFORT_COPY: Record<string, string> = {
  low: 'Fastest. Best for small, well-specified edits.',
  medium: 'Balanced.',
  high: 'Thinks longer before acting. Better on ambiguous work.',
  xhigh: 'Substantially longer reasoning.',
  max: 'Maximum reasoning. Slowest and most expensive.',
};

/** Server values for `PATCH /api/chats/:id { permissionMode }`. */
export const PERMISSION_MODES: readonly OptionModel<'default' | 'acceptEdits' | 'bypassPermissions'>[] = [
  { value: 'default', title: 'Ask me', help: 'Pause for approval before sensitive actions.' },
  { value: 'acceptEdits', title: 'Auto-accept edits', help: 'File edits apply without asking.' },
  {
    value: 'bypassPermissions',
    title: 'Full autonomy',
    help: 'Nothing is gated. Use only in a sandbox you can throw away.',
  },
];

export type ContextTier = 'default' | 'long_context';

export const TIER_OPTIONS: readonly OptionModel<ContextTier>[] = [
  { value: 'default', title: 'Standard', help: 'The model’s normal context window.' },
  { value: 'long_context', title: 'Long context', help: 'Larger window, slower and pricier per turn.' },
];

export function effortOptionsFor(model: ModelInfo | undefined): OptionModel<string>[] {
  return reasoningEfforts(model).map((value) => ({
    value,
    title: value.charAt(0).toUpperCase() + value.slice(1),
    help: EFFORT_COPY[value] ?? '',
  }));
}

/** The effective effort: the explicit one, else the model's default. */
export function effectiveEffort(effort: string | null, model: ModelInfo | undefined): string | null {
  return effort ?? model?.defaultReasoningEffort ?? null;
}

export function modeLabel(mode: AgentMode): string {
  return MODE_OPTIONS.find((m) => m.value === mode)?.title ?? mode;
}

export function permissionLabel(mode: string): string {
  return PERMISSION_MODES.find((m) => m.value === mode)?.title ?? mode;
}

/**
 * The single composer chip: what this turn will do, in one line.
 *
 * Three separate pickers (model, mode, options) for one decision needed
 * 280pt of a 253pt strip, so the third was permanently cut in half. The
 * model's short name leads because it is what changes the answer most; the
 * mode follows only when it is NOT the default, and any other override is
 * summarised after it.
 */
export function turnChipLabel(input: {
  model: ModelInfo | undefined;
  mode: AgentMode;
  effort: string | null;
  permissionMode: string;
  contextTier: ContextTier;
}): string {
  const parts: string[] = [shortModelName(input.model)];
  if (input.mode !== 'auto') parts.push(modeLabel(input.mode));
  const options = optionsChipLabel({
    effort: input.effort,
    model: input.model,
    permissionMode: input.permissionMode,
    contextTier: input.contextTier,
  });
  if (options !== 'Options') parts.push(options);
  return parts.join(' · ');
}

/**
 * "Claude Sonnet 5" → "Sonnet 5". The vendor prefix is the same on every
 * model in the list, so it is the half that carries no information in a
 * 150pt chip.
 */
export function shortModelName(model: ModelInfo | undefined): string {
  // No explicit model means the chat follows the provider's default, which is
  // a real, nameable state — "Model" read like a control that had not loaded.
  if (!model) return 'Default model';
  return model.name.replace(/^(claude|gpt|gemini|openai|anthropic|google)[\s-]*/i, '').trim() || model.name;
}

/**
 * The composer's turn chip, split for drawing: the short model name as the
 * only TEXT, and each non-default setting as a flag the chip draws as a small
 * glyph. The joined `turnChipLabel` still exists — it is the accessibility
 * label, so a screen reader hears everything the glyphs stand for.
 *
 * Effort counts as "set" only when it differs from the model's own default:
 * "Medium" on a medium-default model is not a choice anyone made.
 */
export interface TurnChipParts {
  model: string;
  plan: boolean;
  /** `null` for the default ("Ask me"). */
  permission: 'acceptEdits' | 'bypassPermissions' | null;
  effortOverride: string | null;
  longContext: boolean;
}

export function turnChipParts(input: {
  model: ModelInfo | undefined;
  mode: AgentMode;
  effort: string | null;
  permissionMode: string;
  contextTier: ContextTier;
}): TurnChipParts {
  const permission =
    input.permissionMode === 'acceptEdits' || input.permissionMode === 'bypassPermissions'
      ? input.permissionMode
      : null;
  const modelDefault = input.model?.defaultReasoningEffort ?? null;
  return {
    model: shortModelName(input.model),
    plan: input.mode === 'plan',
    permission,
    effortOverride: input.effort && input.effort !== modelDefault ? input.effort : null,
    longContext: input.contextTier === 'long_context',
  };
}

/** Short summary for the options chip: "High · Ask me". */
export function optionsChipLabel(input: {
  effort: string | null;
  model: ModelInfo | undefined;
  permissionMode: string;
  contextTier: ContextTier;
}): string {
  const parts: string[] = [];
  const effort = effectiveEffort(input.effort, input.model);
  if (effort) parts.push(effort.charAt(0).toUpperCase() + effort.slice(1));
  if (input.contextTier === 'long_context') parts.push('Long ctx');
  if (input.permissionMode !== 'default') parts.push(permissionLabel(input.permissionMode));
  return parts.length ? parts.join(' · ') : 'Options';
}

/** Whether the chosen agent mode is the one the chat defaults to. */
export function isModeOverride(mode: AgentMode, chatDefault: AgentMode | null | undefined): boolean {
  return mode !== (chatDefault ?? 'auto');
}
