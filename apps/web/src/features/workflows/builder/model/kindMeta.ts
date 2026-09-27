// ────────────────────────────────────────────────────────────────
// kindMeta — the glyph and wording of each stage kind in the builder (the
// kind palette, the canvas nodes, the inspector subtitle).
// ────────────────────────────────────────────────────────────────

import type { IconConcept } from '@generatorai/design-tokens';
import type { StageKind } from '@generatorai/workflow-spec';

export interface KindMeta {
  icon: IconConcept;
  /** Short name ("Agent", "Check"). */
  name: string;
  /** Inspector subtitle noun ("Agent stage", "Loop stage"). */
  noun: string;
  /** One line on what the kind does (the kind palette). */
  hint: string;
  /** Saving a stage of this kind needs the admin:settings scope (it runs a command). */
  admin?: boolean;
}

export const KIND_META: Record<StageKind, KindMeta> = {
  agent: { icon: 'agents', name: 'Agent', noun: 'Agent stage', hint: 'An agent turn (the default)' },
  check: { icon: 'terminal', name: 'Check', noun: 'Check stage', hint: 'Runs one allowlisted command, no LLM', admin: true },
  loop: { icon: 'repeat', name: 'Loop', noun: 'Loop stage', hint: 'Repeats its body until a rule fires' },
  map: { icon: 'layers', name: 'Map', noun: 'Map stage', hint: 'Runs its body once per item of a list' },
  subworkflow: { icon: 'workflows', name: 'Sub-workflow', noun: 'Sub-workflow stage', hint: 'Runs another published workflow' },
  wait: { icon: 'hourglass', name: 'Wait', noun: 'Wait stage', hint: 'Approval form, external event or timer' },
};

/** The kinds the add menus offer, in menu order. */
export const ADDABLE_KINDS: readonly StageKind[] = ['agent', 'check', 'loop', 'map', 'subworkflow', 'wait'];
