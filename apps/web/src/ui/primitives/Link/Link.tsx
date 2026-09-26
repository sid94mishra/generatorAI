// ────────────────────────────────────────────────────────────────
// P-42 Link (03 §2 P-42): `muted` (breadcrumb ancestors: fg-3, hover fg, no
// underline) · `default` (fg, underline on hover; row titles) · `external`
// (trailing 12px icon, new tab, `rel="noopener noreferrer"`).
// The kit never imports the router: pass it through `render`:
// `<Link render={<RouterLink to="/chats" />}>Chats</Link>`.
// ────────────────────────────────────────────────────────────────

import { cva } from 'class-variance-authority';
import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cn } from '../../lib/cn.js';
import { focusRing } from '../../lib/focus.js';
import { Icon } from '../../icons/Icon.js';

export const linkVariants = cva(
  ['inline-flex min-w-0 items-center gap-1 rounded-badge underline-offset-2 transition-control', focusRing],
  {
    variants: {
      variant: {
        muted: 'text-fg-3 no-underline hover:text-fg',
        default: 'text-fg no-underline hover:underline',
        external: 'text-fg underline decoration-line-strong hover:decoration-fg',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface LinkProps extends useRender.ComponentProps<'a'> {
  variant?: 'muted' | 'default' | 'external';
}

/** A text link. `external` opens in a new tab and says so to screen readers. */
export function Link({ variant = 'default', render, ref, className, children, ...rest }: LinkProps) {
  const external = variant === 'external';
  const ownProps = {
    className: cn(linkVariants({ variant }), className),
    ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
    children: external ? (
      <>
        {children}
        <Icon concept="external-link" size={12} className="text-fg-3" />
        <span className="sr-only"> (opens in a new tab)</span>
      </>
    ) : (
      children
    ),
  };
  return useRender({ defaultTagName: 'a', render, ref, props: mergeProps<'a'>(rest, ownProps) });
}
