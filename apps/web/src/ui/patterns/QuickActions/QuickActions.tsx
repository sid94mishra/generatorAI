// ────────────────────────────────────────────────────────────────
// C-40 QuickActions (D-134): Home's "Start" row — a grid of action tiles that
// start the common work (new chat, run or build a workflow, new agent).
//
// Each tile is a P-55 ActionTile (icon well · title over a one-line
// description · optional Kbd chord). Two columns by default; `columns={4}`
// for a single compact row.
// The caller resolves shortcuts per host (D-24) — the kit never detects the
// platform.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { ActionTile } from '../../primitives/ActionTile/ActionTile.js';

export interface QuickAction {
  id: string;
  icon: IconConcept;
  title: string;
  description?: string;
  /** One chord, already resolved for this host: `['⌘', 'N']`. */
  shortcut?: readonly string[] | undefined;
  onSelect: () => void;
}

export interface QuickActionsProps extends Omit<ComponentProps<'div'>, 'children'> {
  actions: readonly QuickAction[];
  /** Accessible name of the group ("Start"). */
  label: string;
  columns?: 2 | 4;
}

/** A grid of tiles, each starting one common action. */
export function QuickActions({ actions, label, columns = 2, className, ...rest }: QuickActionsProps) {
  return (
    <div role="group" aria-label={label} className={cn('grid gap-3', columns === 4 ? 'grid-cols-4' : 'grid-cols-2', className)} {...rest}>
      {actions.map((action) => (
        <ActionTile
          key={action.id}
          icon={action.icon}
          title={action.title}
          description={action.description}
          shortcut={action.shortcut}
          onClick={action.onSelect}
          data-testid={`quick-action-${action.id}`}
        />
      ))}
    </div>
  );
}
