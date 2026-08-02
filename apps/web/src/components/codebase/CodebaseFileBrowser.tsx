// ────────────────────────────────────────────────────────────────
// CodebaseFileBrowser — File tree with .gitignore filtering
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Loader2, ChevronRight, ChevronDown } from 'lucide-react';
import { useCodebaseFiles } from '@/hooks/projectQueries.js';
import { FileTypeIcon, FolderTypeIcon } from '@/components/shared/fileIcons.js';
import { cn } from '@/lib/utils.js';
import type { FileEntry } from '@generatorai/shared';

interface CodebaseFileBrowserProps {
  projectId: string;
  codebaseId: string;
  onFileSelect?: (filePath: string) => void;
  selectedFile?: string | null;
  noBorder?: boolean;
  className?: string;
  /** Case-insensitive name filter applied at each loaded tree level. */
  filter?: string;
}

export function CodebaseFileBrowser({
  projectId,
  codebaseId,
  onFileSelect,
  selectedFile,
  noBorder = false,
  className = '',
  filter = '',
}: CodebaseFileBrowserProps) {
  const { data: rootFiles, isLoading, error } = useCodebaseFiles(projectId, codebaseId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="py-4 text-center text-xs text-red-500">
        Failed to load files: {(error as Error).message}
      </p>
    );
  }

  if (!rootFiles || rootFiles.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-[var(--color-muted-foreground)]">
        No files found in this codebase.
      </p>
    );
  }

  const q = filter.trim().toLowerCase();
  // While filtering keep directories so nested matches can surface (dirs
  // auto-expand); files are matched by name.
  const visibleRoot = q
    ? rootFiles.filter((e) => e.type === 'directory' || e.name.toLowerCase().includes(q))
    : rootFiles;

  return (
    <div className={cn(noBorder ? 'flex min-h-0 flex-1 flex-col' : 'rounded-lg border border-[var(--color-border)] overflow-hidden', className)}>
      <div className={cn(noBorder ? 'min-h-0 flex-1' : 'max-h-[500px]', 'overflow-y-auto p-2')}>
        {visibleRoot.length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--color-muted-foreground)]">
            No files match “{filter}”.
          </p>
        ) : (
          visibleRoot.map((entry) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              projectId={projectId}
              codebaseId={codebaseId}
              depth={0}
              selectedFile={selectedFile}
              onFileSelect={onFileSelect}
              filter={q}
            />
          ))
        )}
      </div>
    </div>
  );
}

function FileTreeNode({
  entry,
  projectId,
  codebaseId,
  depth,
  onFileSelect,
  selectedFile,
  filter = '',
}: {
  entry: FileEntry;
  projectId: string;
  codebaseId: string;
  depth: number;
  onFileSelect?: (filePath: string) => void;
  selectedFile?: string | null;
  filter?: string;
}) {
  const [manualExpanded, setManualExpanded] = useState(false);
  const isDir = entry.type === 'directory';
  const q = filter.trim().toLowerCase();
  const expanded = isDir && manualExpanded;

  // Lazy-load children for directories
  const { data: children, isLoading } = useCodebaseFiles(
    projectId,
    codebaseId,
    expanded && isDir ? entry.path : undefined,
  );

  const visibleChildren = q
    ? (children ?? []).filter((c) => c.type === 'directory' || c.name.toLowerCase().includes(q))
    : (children ?? []);

  const handleClick = () => {
    if (isDir) {
      setManualExpanded((v) => !v);
    } else {
      onFileSelect?.(entry.path);
    }
  };

  const formatSize = (bytes?: number) => {
    if (bytes === undefined) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={cn(
          'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-xs transition-colors hover:bg-[var(--color-accent)]',
          !isDir && 'cursor-pointer',
          !isDir && selectedFile === entry.path &&
            'bg-[var(--color-primary)]/15 text-[var(--color-primary)] font-medium',
        )}
        style={{ paddingLeft: `${depth * 16 + 6}px` }}
      >
        {isDir ? (
          <>
            {expanded ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-[var(--color-muted-foreground)]" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-[var(--color-muted-foreground)]" />
            )}
            <FolderTypeIcon open={expanded} className="h-3.5 w-3.5" />
          </>
        ) : (
          <>
            <span className="w-3" />
            <FileTypeIcon name={entry.name} className="h-3.5 w-3.5" />
          </>
        )}
        <span className="truncate text-[var(--color-foreground)]">{entry.name}</span>
        {!isDir && entry.size !== undefined && (
          <span className="ml-auto shrink-0 text-[10px] text-[var(--color-muted-foreground)]">
            {formatSize(entry.size)}
          </span>
        )}
      </button>

      {isDir && expanded && (
        <div>
          {isLoading ? (
            <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: `${(depth + 1) * 16 + 6}px` }}>
              <Loader2 className="h-3 w-3 animate-spin text-[var(--color-muted-foreground)]" />
              <span className="text-[10px] text-[var(--color-muted-foreground)]">Loading...</span>
            </div>
          ) : children && children.length > 0 ? (
            visibleChildren.length > 0 ? (
              visibleChildren.map((child) => (
                <FileTreeNode
                  key={child.path}
                  entry={child}
                  projectId={projectId}
                  codebaseId={codebaseId}
                  depth={depth + 1}
                  selectedFile={selectedFile}
                  onFileSelect={onFileSelect}
                  filter={filter}
                />
              ))
            ) : (
              <p
                className="py-1 text-[10px] text-[var(--color-muted-foreground)]"
                style={{ paddingLeft: `${(depth + 1) * 16 + 6}px` }}
              >
                No matches
              </p>
            )
          ) : (
            <p
              className="py-1 text-[10px] text-[var(--color-muted-foreground)]"
              style={{ paddingLeft: `${(depth + 1) * 16 + 6}px` }}
            >
              Empty directory
            </p>
          )}
        </div>
      )}
    </div>
  );
}
