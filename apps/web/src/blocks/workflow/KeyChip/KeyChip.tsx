// ────────────────────────────────────────────────────────────────
// WF-02 KeyChip — a stage key in mono (03-domain §4): `assess_risk` on
// builder nodes, in the inspector subtitle, the run stage table, validation
// problems and draft diffs. `bare` drops the border (tables, inline text);
// `hint` adds the "· from name" note of the inspector's key field.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { cn } from '@/ui/lib/cn.js';

export interface KeyChipProps {
  stageKey: string;
  /** No border (table cells, inline text). */
  bare?: boolean;
  /** Trailing hint ("from name"). */
  hint?: ReactNode;
  className?: string;
}

/** A stage key, mono. */
export function KeyChip({ stageKey, bare = false, hint, className }: KeyChipProps) {
  return (
    <Chip mono size="sm" variant={bare ? 'ghost' : 'outline'} className={cn(bare && 'px-0', className)} title={stageKey}>
      <span className="truncate">{stageKey}</span>
      {hint != null ? <span className="font-sans text-fg-3">· {hint}</span> : null}
    </Chip>
  );
}
