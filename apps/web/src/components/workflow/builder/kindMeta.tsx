// ────────────────────────────────────────────────────────────────
// kindMeta — the icon and wording of each stage kind in the builder
// (the add menus, the group nodes, the kind panels).
// ────────────────────────────────────────────────────────────────

import type { LucideIcon } from 'lucide-react';
import { Bot, Hourglass, Layers3, Repeat, SquareTerminal, Workflow } from 'lucide-react';
import type { StageKind } from '@generatorai/workflow-spec';

export interface KindMeta {
  icon: LucideIcon;
  /** Menu label. */
  label: string;
  /** One line on what the kind does. */
  hint: string;
}

export const KIND_META: Record<StageKind, KindMeta> = {
  agent: { icon: Bot, label: 'Agent stage', hint: 'An LLM agent' },
  check: { icon: SquareTerminal, label: 'Check (runs a command)', hint: 'One deterministic command, no LLM' },
  loop: { icon: Repeat, label: 'Loop', hint: 'Repeat its body until a rule fires' },
  map: { icon: Layers3, label: 'Map (fan out over a list)', hint: 'Run its body once per item of a list' },
  subworkflow: { icon: Workflow, label: 'Sub-workflow', hint: 'Run another published workflow as a stage' },
  wait: { icon: Hourglass, label: 'Wait (approval, event, timer)', hint: 'Park without an agent until something happens' },
};

/** The kinds the add menus offer, in menu order. */
export const ADDABLE_KINDS: readonly StageKind[] = ['agent', 'check', 'loop', 'map', 'subworkflow', 'wait'];
