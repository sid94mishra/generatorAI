// ────────────────────────────────────────────────────────────────
// FileExplorer — reusable two-pane file viewer shell.
// A "Filter files…" box + a scrollable file tree on the left, and a
// content/preview pane on the right with an "Open a file" empty state.
// Purely presentational: callers plug in their own tree (via `tree`)
// and content (via `children`). Scrolls only inside the tree and the
// content pane — never the page. Reused by the codebase Files tab and
// can host the chat / workflow right-pane file views.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Search, Code2, X } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Input, Button } from '@/components/ui/index.js';

export interface FileExplorerProps {
  /** The file-tree content (already scoped to its own component). */
  tree: React.ReactNode;
  /** Right-pane content. When falsy, the empty state renders instead. */
  children?: React.ReactNode;
  /** Controlled filter value for the tree search box. */
  filter: string;
  onFilterChange: (value: string) => void;
  /** Whether a file is selected (drives the empty-state fallback). */
  hasSelection?: boolean;
  /** Optional custom empty state (defaults to an "Open a file" prompt). */
  emptyState?: React.ReactNode;
  /** Optional actions rendered on the right of the tree header. */
  treeHeaderRight?: React.ReactNode;
  /** Tree column width (Tailwind width class). Defaults to w-72. */
  treeWidthClassName?: string;
  filterPlaceholder?: string;
  className?: string;
}

export function FileExplorer({
  tree,
  children,
  filter,
  onFilterChange,
  hasSelection = false,
  emptyState,
  treeHeaderRight,
  treeWidthClassName = 'w-72',
  filterPlaceholder = 'Filter files…',
  className,
}: FileExplorerProps) {
  return (
    <div className={cn('flex h-full min-h-0 overflow-hidden rounded-xl border border-border bg-card', className)}>
      {/* Left: filter + tree */}
      <div className={cn('flex min-h-0 shrink-0 flex-col border-r border-border bg-subtle/30', treeWidthClassName)}>
        <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              placeholder={filterPlaceholder}
              className={cn(
                'h-8 w-full rounded-md border border-border bg-background pl-8 pr-7 text-xs text-foreground',
                'placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-ring/40',
              )}
            />
            {filter && (
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                onClick={() => onFilterChange('')}
                aria-label="Clear filter"
                className="h-auto w-auto absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-subtle hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {treeHeaderRight}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tree}
        </div>
      </div>

      {/* Right: content / preview */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {hasSelection && children ? (
          children
        ) : (
          emptyState ?? <FileExplorerEmptyState />
        )}
      </div>
    </div>
  );
}

export function FileExplorerEmptyState({
  title = 'Open a file',
  hint = 'Choose a file from the tree to preview it here.',
}: {
  title?: string;
  hint?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
      <Code2 className="h-8 w-8 opacity-30" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
