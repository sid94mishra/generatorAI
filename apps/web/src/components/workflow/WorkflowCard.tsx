// ────────────────────────────────────────────────────────────────
// WorkflowCard / WorkflowListRow
// Shared composites for workflow surfaces, previously duplicated
// across DashboardPage and WorkflowListPage.
// Built on the canonical ui primitives. (Template cards now use
// <EntityCard> from @/components/data.)
// ────────────────────────────────────────────────────────────────

import React from 'react';
import {
  GitBranch,
  Edit3,
  Play,
  Trash2,
  Calendar,
  Clock,
  CheckSquare,
  Square,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { Card, Badge, Button } from '@/components/ui/index.js';
import { EntityListRow } from '@/components/data/index.js';
import { cn } from '@/lib/utils.js';
import type { WorkflowDefinition } from '@generatorai/shared';

// ── WorkflowCard (grid) ──

export interface WorkflowCardProps {
  definition: WorkflowDefinition;
  onClick: () => void;
  /** When provided, the corresponding hover action button is shown */
  onEdit?: () => void;
  onRun?: () => void;
  onDelete?: (e: React.MouseEvent) => void;
  /** Selection (bulk) mode */
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** Show the session-mode + created-date footer (default true) */
  showFooter?: boolean;
}

export function WorkflowCard({
  definition,
  onClick,
  onEdit,
  onRun,
  onDelete,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  showFooter = true,
}: WorkflowCardProps) {
  const hasActions = !selectionMode && (onEdit || onRun || onDelete);
  // Outside selection mode the card is a navigation, so it gets a real
  // stretched anchor (see `EntityListRow`): a `div role="button"` that calls
  // `navigate()` supports no middle-click, no ctrl-click, no copy-link and
  // announces itself as a button rather than a link. In selection mode the
  // card toggles a checkbox and goes nowhere, so it stays a button.
  const asLink = !selectionMode;
  return (
    <Card
      interactive
      role={asLink ? undefined : 'button'}
      tabIndex={asLink ? undefined : 0}
      onClick={asLink ? undefined : onClick}
      onKeyDown={
        asLink
          ? undefined
          : (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
      }
      className={cn(
        'group flex h-full flex-col p-4',
        asLink ? 'relative' : 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selectionMode && selected && 'ring-2 ring-primary bg-primary/5',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {selectionMode ? (
            <button
              type="button"
              role="checkbox"
              aria-checked={selected}
              aria-label={`${selected ? 'Deselect' : 'Select'} ${definition.name}`}
              onClick={(e) => { e.stopPropagation(); onToggleSelect?.(); }}
              className="shrink-0"
            >
              {selected
                ? <CheckSquare className="h-5 w-5 text-primary" />
                : <Square className="h-5 w-5 text-muted-foreground" />}
            </button>
          ) : (
            <GitBranch className="h-5 w-5 shrink-0 text-primary" />
          )}
          {asLink ? (
            // `after:absolute after:inset-0` stretches the hit area over the
            // whole card while leaving the title's layout untouched.
            <Link
              to={`/workflows/${definition.id}`}
              className="min-w-0 after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              <h3 className="truncate text-sm font-semibold text-foreground">{definition.name}</h3>
            </Link>
          ) : (
            <h3 className="truncate text-sm font-semibold text-foreground">{definition.name}</h3>
          )}
        </div>
        {hasActions && (
          // Collapsed until hover/focus rather than merely transparent: hidden
          // actions that still took up room truncated every title to make
          // space for invisible icons. `relative` keeps them above the
          // stretched link overlay so their clicks land on the button.
          <div className="relative ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex">
            {onEdit && (
              <Button onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit"
                variant="ghost" size="icon-sm"
                className="h-auto w-auto rounded p-1 text-muted-foreground hover:bg-subtle hover:text-foreground">
                <Edit3 className="h-3.5 w-3.5" />
              </Button>
            )}
            {onRun && (
              <Button onClick={(e) => { e.stopPropagation(); onRun(); }} title="Run"
                variant="ghost" size="icon-sm"
                className="h-auto w-auto rounded p-1 text-muted-foreground hover:bg-success-muted hover:text-success">
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
            {onDelete && (
              <Button onClick={onDelete} title="Delete"
                variant="ghost" size="icon-sm"
                className="h-auto w-auto rounded p-1 text-muted-foreground hover:bg-danger-muted hover:text-danger">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>

      {definition.description && (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{definition.description}</p>
      )}

      {definition.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {definition.tags.slice(0, 4).map((tag) => (
            <Badge key={tag} tone="neutral" size="sm">{tag}</Badge>
          ))}
        </div>
      )}

      {showFooter && (
        <div className="mt-auto flex items-center justify-between pt-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{definition.sessionMode}</span>
          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(definition.createdAt).toLocaleDateString()}</span>
        </div>
      )}
    </Card>
  );
}

// ── WorkflowListRow (list view) ──

export interface WorkflowListRowProps {
  definition: WorkflowDefinition;
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: (e: React.MouseEvent) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export function WorkflowListRow({
  definition,
  onClick,
  onEdit,
  onDelete,
  selectionMode = false,
  selected = false,
  onToggleSelect,
}: WorkflowListRowProps) {
  return (
    <EntityListRow
      // A real link when the row navigates, so middle-click, ctrl-click and
      // "copy link address" work; a click handler in selection mode, where
      // the row toggles a checkbox and goes nowhere.
      {...(selectionMode ? { onClick } : { href: `/workflows/${definition.id}` })}
      className={cn(selectionMode && selected && 'ring-2 ring-ring bg-primary/5')}
      leading={
        selectionMode ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={`${selected ? 'Deselect' : 'Select'} ${definition.name}`}
            onClick={(e) => { e.stopPropagation(); onToggleSelect?.(); }}
            className="shrink-0"
          >
            {selected
              ? <CheckSquare className="h-5 w-5 text-primary" />
              : <Square className="h-5 w-5 text-muted-foreground" />}
          </button>
        ) : (
          <GitBranch className="h-5 w-5 text-primary" />
        )
      }
      title={
        <>
          <span className="truncate">{definition.name}</span>
          {definition.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} tone="neutral" size="sm">{tag}</Badge>
          ))}
        </>
      }
      description={
        definition.description && (
          <span className="block truncate">{definition.description}</span>
        )
      }
      trailing={
        <>
          <span className="text-xs text-muted-foreground">{definition.sessionMode}</span>
          <span className="text-xs text-muted-foreground">{new Date(definition.createdAt).toLocaleDateString()}</span>
        </>
      }
      actions={
        !selectionMode && (onEdit || onDelete) ? (
          <>
            {onEdit && (
              <Button onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit"
                variant="ghost" size="icon-sm"
                className="h-auto w-auto rounded p-1 text-muted-foreground hover:bg-subtle hover:text-foreground">
                <Edit3 className="h-3.5 w-3.5" />
              </Button>
            )}
            {onDelete && (
              <Button onClick={onDelete} title="Delete"
                variant="ghost" size="icon-sm"
                className="h-auto w-auto rounded p-1 text-muted-foreground hover:bg-danger-muted hover:text-danger">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        ) : undefined
      }
    />
  );
}
