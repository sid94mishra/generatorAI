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
import { Card, Badge } from '@/components/ui/index.js';
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
  return (
    <Card
      interactive
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'group flex h-full flex-col p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selectionMode && selected && 'ring-2 ring-primary bg-primary/5',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {selectionMode ? (
            <button onClick={(e) => { e.stopPropagation(); onToggleSelect?.(); }} className="shrink-0">
              {selected
                ? <CheckSquare className="h-5 w-5 text-primary" />
                : <Square className="h-5 w-5 text-muted-foreground" />}
            </button>
          ) : (
            <GitBranch className="h-5 w-5 shrink-0 text-primary" />
          )}
          <h3 className="truncate text-sm font-semibold text-foreground">{definition.name}</h3>
        </div>
        {hasActions && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-all group-hover:opacity-100 focus-within:opacity-100">
            {onEdit && (
              <button onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit"
                className="rounded p-1 text-muted-foreground hover:bg-subtle hover:text-foreground">
                <Edit3 className="h-3.5 w-3.5" />
              </button>
            )}
            {onRun && (
              <button onClick={(e) => { e.stopPropagation(); onRun(); }} title="Run"
                className="rounded p-1 text-muted-foreground hover:bg-success-muted hover:text-success">
                <Play className="h-3.5 w-3.5" />
              </button>
            )}
            {onDelete && (
              <button onClick={onDelete} title="Delete"
                className="rounded p-1 text-muted-foreground hover:bg-danger-muted hover:text-danger">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
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
      onClick={onClick}
      className={cn(selectionMode && selected && 'ring-2 ring-ring bg-primary/5')}
      leading={
        selectionMode ? (
          <button onClick={(e) => { e.stopPropagation(); onToggleSelect?.(); }} className="shrink-0">
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
              <button onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit"
                className="rounded p-1 text-muted-foreground hover:bg-subtle hover:text-foreground">
                <Edit3 className="h-3.5 w-3.5" />
              </button>
            )}
            {onDelete && (
              <button onClick={onDelete} title="Delete"
                className="rounded p-1 text-muted-foreground hover:bg-danger-muted hover:text-danger">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        ) : undefined
      }
    />
  );
}
