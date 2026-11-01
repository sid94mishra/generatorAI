// ────────────────────────────────────────────────────────────────
// SummaryLine — one line of a glance card (the chat summary beside the
// transcript): a 14px glyph · a title over an optional one-line detail
// (`text-small`, `fg` / `fg-3`, each truncated with the full text on hover) ·
// an optional trailing node (a DiffStat) · a chevron when the line opens
// something. Pad 6 8, control radius. With `onClick` (or `render`) the whole
// line is one button that fills `hover`; without, a plain row.
//
// The glyph is `icon`, or `image` (a page's favicon) drawn in its place and
// falling back to `icon` if it fails to load, or any `glyph` node (an editor's
// mark). A command line (`chevron={false}`) runs something rather than
// opening a view, so it carries no chevron.
// ────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from 'react';
import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { focusRing } from '../../lib/focus.js';
import { Icon } from '../../icons/Icon.js';

export interface SummaryLineProps extends Omit<useRender.ComponentProps<'button'>, 'children' | 'title'> {
  icon: IconConcept;
  /** Drawn in place of `icon` (a favicon); `icon` again if it fails to load. */
  image?: string | undefined;
  title: string;
  /** The title in mono (a branch, a path). */
  mono?: boolean;
  detail?: string | undefined;
  /** After the text (a DiffStat). */
  trailing?: ReactNode;
  /** A glyph node in place of `icon` / `image` (an editor's mark), 14px. */
  glyph?: ReactNode;
  /** The trailing chevron of a line that opens a view; default: whenever the line is a button. */
  chevron?: boolean;
}

function Glyph({ icon, image }: { icon: IconConcept; image: string | undefined }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (image && broken !== image) {
    return <img src={image} alt="" className="size-3.5 rounded-badge object-contain" onError={() => setBroken(image)} />;
  }
  return <Icon concept={icon} size={14} />;
}

/** One glance-card line: glyph, title over detail, trailing, and a chevron when it opens something. */
export function SummaryLine({
  icon,
  image,
  glyph,
  title,
  mono = false,
  detail,
  trailing,
  chevron,
  render,
  ref,
  className,
  onClick,
  ...rest
}: SummaryLineProps) {
  const opens = onClick !== undefined || render !== undefined;
  const ownProps = {
    ...(opens && !render ? { type: 'button' as const } : {}),
    ...(onClick ? { onClick } : {}),
    className: cn(
      // text-small on the row: `h-lh` below is one line of the title, so the glyph and chevron centre on it.
      'flex w-full min-w-0 items-start gap-2 rounded-control px-2 py-1.5 text-left text-small',
      opens && cn('cursor-pointer transition-control hover:bg-hover', focusRing),
      className,
    ),
    children: (
      <>
        <span className="flex h-lh shrink-0 items-center text-fg-3">
          {glyph ?? <Glyph icon={icon} image={image} />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn('truncate text-small text-fg', mono && 'font-mono')} title={title}>
            {title}
          </span>
          {detail ? (
            <span className="truncate text-small text-fg-3" title={detail}>
              {detail}
            </span>
          ) : null}
        </span>
        {trailing ? <span className="flex h-lh shrink-0 items-center">{trailing}</span> : null}
        {(chevron ?? opens) ? (
          <span className="flex h-lh shrink-0 items-center text-fg-3">
            <Icon concept="chevron-right" size={12} />
          </span>
        ) : null}
      </>
    ),
  };
  return useRender({ defaultTagName: opens ? 'button' : 'div', render, ref, props: mergeProps<'button'>(rest, ownProps) });
}
