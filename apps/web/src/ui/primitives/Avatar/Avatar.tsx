// ────────────────────────────────────────────────────────────────
// P-10 Avatar — a human/agent initials tile (03 §2 P-10; Rosetta `.av`).
//
// Square `bg-selected text-fg-2` 600; sizes 18 · 20 · 24 (default) · 32
// (32 uses the card radius, ≤ 24 the control radius). Initials are derived
// from `name`; `src` shows an image once it has loaded (Base UI Avatar), the
// initials otherwise. Desktop only — workflow surfaces use AgentGlyph (P-11,
// Phase PW) and mobile bans initials avatars.
// With `decorative` the tile is hidden from assistive tech (the name is
// already written next to it, as in the ChatsList agent column).
// ────────────────────────────────────────────────────────────────

import { Avatar as BaseAvatar } from '@base-ui/react/avatar';
import { cn } from '../../lib/cn.js';
import { AVATAR_SIZE_CLASSES, type AvatarSize } from '../../lib/avatar.js';

/** "Bug Fixer" → "BF", "orchestrator" → "OR", "Faux (test)" → "FT", "" → "?". Punctuation never shows. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return '?';
  const [first = '', second] = words;
  const letters = second ? `${first[0] ?? ''}${second[0] ?? ''}` : first.slice(0, 2);
  return letters.toUpperCase();
}

export interface AvatarProps extends Omit<BaseAvatar.Root.Props, 'children'> {
  /** Person or agent name: the initials and the accessible name. */
  name: string;
  size?: AvatarSize;
  /** Optional image; the initials show until (and unless) it loads. */
  src?: string;
  /** Hide from assistive tech when the name is written next to the tile. */
  decorative?: boolean;
}

/** Initials tile (with an optional image) for a person or an agent. */
export function Avatar({ name, size = 24, src, decorative = false, className, ...rest }: AvatarProps) {
  const a11y = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name };
  return (
    <BaseAvatar.Root
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-selected font-semibold text-fg-2 select-none',
        AVATAR_SIZE_CLASSES[size],
        className,
      )}
      {...a11y}
      {...rest}
    >
      {src ? <BaseAvatar.Image src={src} alt="" className="absolute inset-0 size-full object-cover" /> : null}
      <BaseAvatar.Fallback>{initialsOf(name)}</BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}
