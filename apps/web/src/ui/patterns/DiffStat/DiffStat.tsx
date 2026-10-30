// ────────────────────────────────────────────────────────────────
// C-33 DiffStat (03 §3 C-33; Rosetta `c-ok "+14"` + `c-err "−6"`).
//
// `font-mono text-micro`: `+N` in `text-ok`, a space, `−N` (U+2212 MINUS
// SIGN, not a hyphen) in `text-err`; optional "N files" in fg-3. Unknown is
// not zero: when both counts are undefined it shows `—` (em dash) in fg-3,
// while 0 renders as `+0` / `−0`. A count that alone is unknown is left out.
// The glyphs are aria-hidden; screen readers get "14 added, 6 removed".
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn.js';

export interface DiffStatProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** Lines added; undefined = unknown. */
  added?: number;
  /** Lines removed; undefined = unknown. */
  removed?: number;
  /** Files changed; shown as a trailing "N files". */
  files?: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Lines added / removed (and files) of a change, green and red, in mono. */
export function DiffStat({ added, removed, files, className, ...rest }: DiffStatProps) {
  const unknown = added === undefined && removed === undefined;
  const spoken = [
    unknown ? 'Changes unknown' : null,
    added !== undefined ? `${added} added` : null,
    removed !== undefined ? `${removed} removed` : null,
    files !== undefined ? plural(files, 'file', 'files') : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <span className={cn('inline-flex items-baseline font-mono text-micro whitespace-pre tabular-nums', className)} {...rest}>
      <span aria-hidden>
        {unknown ? <span className="text-fg-3">—</span> : null}
        {added !== undefined ? <span className="text-ok">+{added}</span> : null}
        {added !== undefined && removed !== undefined ? ' ' : null}
        {removed !== undefined ? <span className="text-err">−{removed}</span> : null}
        {files !== undefined ? <span className="text-fg-3"> {plural(files, 'file', 'files')}</span> : null}
      </span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
