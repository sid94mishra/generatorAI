// Pure Popover logic (03 MP-49): placement against an anchor, the height cap and the overlay marker.

/** nativeID on the popover layer so the side panels never treat its taps as scrim taps (03 MP-49 `isOverlay`). */
export const POPOVER_OVERLAY_ID = 'gai-overlay';

export const POPOVER_GAP = 8;

/** Absolute offsets inside the container for an anchor rect (container coordinates). */
export function popoverOffsets(
  anchor: { y: number; height: number } | null,
  containerHeight: number,
  placement: 'top' | 'bottom',
): { top?: number; bottom?: number } {
  if (!anchor) return placement === 'top' ? { bottom: containerHeight + POPOVER_GAP } : { top: containerHeight + POPOVER_GAP };
  return placement === 'top' ? { bottom: containerHeight - anchor.y + POPOVER_GAP } : { top: anchor.y + anchor.height + POPOVER_GAP };
}

/** Max height: half the space above the keyboard (03 MP-49). */
export function popoverMaxHeight(windowHeight: number, keyboardHeight: number): number {
  return Math.max(120, Math.round((windowHeight - Math.abs(keyboardHeight)) * 0.5));
}

export function popoverAnnouncement(label: string, resultCount?: number): string {
  if (resultCount === undefined) return label;
  return `${label}, ${resultCount} ${resultCount === 1 ? 'result' : 'results'}`;
}
