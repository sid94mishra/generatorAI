// ────────────────────────────────────────────────────────────────
// MountFileTree — the Files dock's tree: one filter over per-mount sections
// of the B-08 FileTree (03 §2.2; boards DockFiles "Tree" / "Filter & states").
//
// One section per mount: header (alias, mode · branch, file count — "2 of
// 214" while filtering) over a virtualized B-08 `FileTree` (its own filter
// off). The filter matches file
// and folder names (path substrings), not contents; `/` inside the panel
// focuses it. Single click selects (preview); double-click / Enter activates
// (the host opens a file tab). With one section the header is omitted and the
// tree fills the column.
// ────────────────────────────────────────────────────────────────

import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/ui/lib/cn.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { FileTree, type FileTreeStatusEntry } from './FileTree.js';
import type { FileTabRef } from './fileTabId.js';

export interface MountTreeSection {
  alias: string;
  /** Header title (the alias, or "workspace root"). */
  title: string;
  /** "Worktree · fix/checkout-flake". */
  subtitle?: string;
  paths: string[];
  /** Git status per repo-relative path (letters in the tree's status lane). */
  statuses?: readonly FileTreeStatusEntry[];
}

export interface MountFileTreeProps {
  sections: MountTreeSection[];
  loading?: boolean;
  selection: FileTabRef | null;
  onSelect: (ref: FileTabRef) => void;
  /** Double-click / Enter. Omit to disable opening files in tabs. */
  onActivate?: (ref: FileTabRef) => void;
  className?: string;
}

/** Case-insensitive path-substring filter (file and folder names). */
export function filterPaths(paths: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...paths];
  return paths.filter((p) => p.toLowerCase().includes(q));
}

export function MountFileTree({ sections, loading = false, selection, onSelect, onActivate, className }: MountFileTreeProps) {
  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLDivElement | null>(null);
  const filtered = useMemo(
    () => sections.map((s) => ({ ...s, shown: filterPaths(s.paths, filter) })),
    [sections, filter],
  );
  const showHeaders = sections.length > 1;
  const total = sections.reduce((n, s) => n + s.paths.length, 0);
  const shownTotal = filtered.reduce((n, s) => n + s.shown.length, 0);

  // `/` focuses the filter — scoped to this panel, so a hidden dock tab never
  // steals the key from the page.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    filterRef.current?.querySelector('input')?.focus();
  };

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)} onKeyDown={onKeyDown}>
      <div ref={filterRef} className="shrink-0 px-2 pt-2 pb-1">
        <SearchInput
          size="sm"
          label="Filter files"
          placeholder="Filter files…"
          shortcut={null}
          value={filter}
          onValueChange={setFilter}
          {...(filter ? { trailing: <span className="font-mono text-small text-fg-3 tabular-nums">{`${shownTotal} files`}</span> } : {})}
        />
      </div>
      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-small text-fg-3">
          <Spinner size={14} /> Loading files…
        </div>
      ) : total === 0 ? (
        <EmptyState icon="files" title="No files in this workspace yet" className="flex-1" />
      ) : shownTotal === 0 ? (
        <EmptyState
          icon="search"
          title={`No files match “${filter.trim()}”`}
          description="The filter matches file and folder names, not file contents."
          action={
            <Button size="sm" onClick={() => setFilter('')}>
              Clear filter
            </Button>
          }
          className="flex-1"
        />
      ) : (
        // Stacked sections share the column; each tree is virtualized at the
        // height its section gets.
        <div className="flex min-h-0 flex-1 flex-col">
          {filtered.map((section) =>
            section.shown.length === 0 && filter ? null : (
              <div key={section.alias} className={cn('flex min-h-0 flex-1 flex-col', showHeaders && 'border-b border-line-soft last:border-b-0')}>
                {showHeaders ? (
                  <MountSectionHeader
                    title={section.title}
                    {...(section.subtitle ? { subtitle: section.subtitle } : {})}
                    count={filter ? `${section.shown.length} of ${section.paths.length}` : `${section.paths.length} files`}
                  />
                ) : null}
                <FileTree
                  paths={section.shown}
                  {...(section.statuses ? { statuses: section.statuses } : {})}
                  filter={false}
                  activePath={selection?.alias === section.alias ? selection.path : null}
                  onSelect={(p) => {
                    // Folder rows arrive with a trailing slash; only files preview.
                    if (!p.endsWith('/')) onSelect({ alias: section.alias, path: p });
                  }}
                  {...(onActivate
                    ? {
                        onActivate: (p: string) => {
                          if (!p.endsWith('/')) onActivate({ alias: section.alias, path: p });
                        },
                      }
                    : {})}
                  className="min-h-0 flex-1"
                />
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function MountSectionHeader({ title, subtitle, count }: { title: string; subtitle?: string; count: string }) {
  return (
    <div className="sticky top-0 z-sticky shrink-0 border-b border-line-soft bg-surface px-2 py-1">
      <div className="flex items-center gap-1.5">
        <Icon concept="folder-open" size={14} className="shrink-0 text-fg-3" />
        <span className="min-w-0 flex-1 truncate font-mono text-small font-medium text-fg" title={title}>
          {title}
        </span>
        <span className="shrink-0 font-mono text-micro text-fg-3 tabular-nums">{count}</span>
      </div>
      {subtitle ? <div className="truncate pl-5 font-mono text-micro text-fg-3">{subtitle}</div> : null}
    </div>
  );
}
