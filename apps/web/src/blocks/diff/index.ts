// ────────────────────────────────────────────────────────────────
// blocks/diff — B-07 DiffView (03-domain §2.2): the virtualized diff surface,
// its worker-pool provider and theme, and the inline review UI (thread card,
// range composer, the floating card they share).
//
// Data contracts (`DiffSource`, `DiffCodeViewHandle` …) live in
// blocks/changes/diffTypes.ts so the Changes hooks never import a component.
// ────────────────────────────────────────────────────────────────

export { DiffCodeView, type DiffCodeViewProps } from './DiffCodeView.js';
export { DiffProviders } from './DiffProviders.js';
export { DIFF_THEMES, DIFF_UNSAFE_CSS, diffHostStyle, treeHostStyleFor } from './diffTheme.js';
export { useDocumentAppearance, type ResolvedAppearance } from './useDocumentAppearance.js';
export { FloatingCard, type FloatingCardProps } from './review/FloatingCard.js';
export { ReviewComposerPopover, type ReviewComposerPopoverProps } from './review/ReviewComposerPopover.js';
export { ReviewThreadCard, type ReviewThreadCardProps } from './review/ReviewThreadCard.js';
