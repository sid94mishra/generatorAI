// ────────────────────────────────────────────────────────────────
// cn — class merging for the kit (D-09, 02 §10.3).
//
// tailwind-merge v3 extended with the design vocabulary from
// packages/design-tokens (`twMergeExtension`), built at runtime so a new token
// name can never drift from the merge config: `cn('text-fg-2', 'text-title')`
// keeps both (colour vs size), `cn('h-row', 'h-full')` keeps `h-full`.
// The legacy `@/lib/utils` cn re-exports this one.
// ────────────────────────────────────────────────────────────────

import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { twMergeExtension } from '@generatorai/design-tokens';

const twMerge = extendTailwindMerge(twMergeExtension());

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
