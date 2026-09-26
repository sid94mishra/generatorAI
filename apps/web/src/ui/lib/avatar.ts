// ────────────────────────────────────────────────────────────────
// Avatar initials sizes (02 §5.2, D-13 exception): 18 and 20 px avatars use
// 9 and 10 px initials — the only sub-11px type in the design. They are not
// steps of the type scale, so they live here, the one sanctioned home of
// arbitrary values, instead of in the component.
// ────────────────────────────────────────────────────────────────

export type AvatarSize = 18 | 20 | 24 | 32;

/** Box, radius and initials size per avatar size (03 §2 P-10). */
export const AVATAR_SIZE_CLASSES: Record<AvatarSize, string> = {
  18: 'size-4.5 rounded-control text-[9px]',
  20: 'size-5 rounded-control text-[10px]',
  24: 'size-6 rounded-control text-micro',
  32: 'size-8 rounded-card text-small',
};
