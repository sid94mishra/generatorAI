// ────────────────────────────────────────────────────────────────
// P-47 Toolbar (03 §2 P-47; Base UI Toolbar; Rosetta `role="group"` of
// ib/btn toolbars).
//
// `role="toolbar"` with roving focus: Tab enters once, arrow keys move between
// items, Home/End jump. Buttons render through `render`:
// `<ToolbarButton render={<Button variant="ghost" size="sm" icon="archive" />}>Archive</ToolbarButton>`.
// `ToolbarSeparator` is a 1×20 line-soft rule with 6px margins. `label` names
// the toolbar ("Bulk actions").
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import { Toolbar as BaseToolbar } from '@base-ui/react/toolbar';
import { cn } from '../../lib/cn.js';

export interface ToolbarProps extends Omit<ComponentProps<typeof BaseToolbar.Root>, 'className'> {
  /** Accessible name. */
  label: string;
  className?: string;
}

/** A row of controls with one tab stop and arrow-key navigation. */
export function Toolbar({ label, className, ...rest }: ToolbarProps) {
  return <BaseToolbar.Root aria-label={label} className={cn('flex items-center gap-1', className)} {...rest} />;
}

/** Groups related items (a visual cluster; no extra tab stop). */
export function ToolbarGroup({ className, ...rest }: Omit<ComponentProps<typeof BaseToolbar.Group>, 'className'> & { className?: string }) {
  return <BaseToolbar.Group className={cn('flex items-center gap-1', className)} {...rest} />;
}

/** A toolbar item; pass the kit control through `render` (Button, IconButton, Chip). */
export const ToolbarButton = BaseToolbar.Button;

/** 1×20 line-soft divider between groups. */
export function ToolbarSeparator({ className, ...rest }: Omit<ComponentProps<typeof BaseToolbar.Separator>, 'className'> & { className?: string }) {
  return <BaseToolbar.Separator className={cn('mx-1.5 min-h-5 self-center border-l border-line-soft', className)} {...rest} />;
}
