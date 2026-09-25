// The legacy import path for `cn` (components/, pages/). It is the kit's cn
// (tailwind-merge v3 + the generated design vocabulary, D-09): on every class
// string in the legacy code it merges exactly as tailwind-merge 2.6 did, and it
// no longer drops design classes (`text-small` beside `text-fg-3`). New code
// imports `cn` from `@/ui/lib/cn`. Deleted with the legacy folders in P7.
export { cn } from '@/ui/lib/cn.js';
