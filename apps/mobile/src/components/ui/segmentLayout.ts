/** Size labels before deciding whether peer navigation needs to scroll. */
export function segmentLayout(
  segments: readonly { label: string; count?: number; live?: boolean; icon?: unknown }[],
  width: number,
  fontScale: number,
): { slot: number; contentWidth: number; scrollable: boolean } {
  if (segments.length === 0) return { slot: 0, contentWidth: 0, scrollable: false };
  const scale = Math.min(1.4, Math.max(1, fontScale));
  const minimum = Math.max(72, ...segments.map((s) =>
    Math.ceil(s.label.length * 8 * scale + 28 + (s.icon ? 24 : 0) +
      (s.count && s.count > 0 ? 12 + String(s.count).length * 8 * scale : 0) + (s.live ? 12 : 0)),
  ));
  const slot = Math.max(minimum, Math.max(0, width) / segments.length);
  const contentWidth = slot * segments.length;
  return { slot, contentWidth, scrollable: contentWidth > width + 1 };
}
