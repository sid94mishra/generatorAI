// ────────────────────────────────────────────────────────────────
// B-09 FileViewer — read-only preview of one workspace file (03 §2.2; board
// DockFiles "Preview · file tab").
//
// Header: optional leading slot (the tree toggle), the path in mono with the
// file name emphasised, size, a Preview / Source toggle for markdown (kit
// Markdown), Wrap and Refresh. Body: the virtualized,
// worker-highlighted code view (`FileCodeView`, line numbers) or the loading /
// deleted / binary / too-large states.
// ────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from 'react';
import { ApiError } from '@/platform/apiFetch.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { DiffProviders } from '@/blocks/diff/DiffProviders.js';
import { Markdown } from '@/ui/patterns/Markdown/Markdown.js';
import { FileCodeView } from './FileCodeView.js';

export interface WorkspaceFileContent {
  contents: string | null;
  isBinary: boolean;
  isTooLarge: boolean;
  size: number;
  cacheKey: string;
}

export interface FileViewerProps {
  /** Repo-relative path. */
  path: string;
  /** Mount alias shown before the path when the workspace has several. */
  alias?: string;
  file: WorkspaceFileContent | undefined;
  loading: boolean;
  error: unknown;
  onRefresh: () => void;
  refreshing?: boolean;
  /** Before the path (the tree toggle). */
  leading?: ReactNode;
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown']);

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.split('.').pop()?.toLowerCase() ?? '');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileViewer({ path, alias, file, loading, error, onRefresh, refreshing = false, leading }: FileViewerProps) {
  const [wrap, setWrap] = useState(false);
  const [markdownMode, setMarkdownMode] = useState<'preview' | 'source'>('preview');
  const markdown = isMarkdownPath(path);
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const name = path.slice(slash + 1);
  const showsCode = !markdown || markdownMode === 'source';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-panel-bar shrink-0 items-center gap-1.5 border-b border-line-soft px-2">
        {leading}
        <span className="min-w-0 flex-1 truncate font-mono text-small text-fg-3" title={alias && alias !== '.' ? `${alias}/${path}` : path}>
          {alias && alias !== '.' ? `${alias}/` : ''}
          {dir}
          <span className="text-fg">{name}</span>
        </span>
        {file ? <span className="shrink-0 font-mono text-small text-fg-3 tabular-nums">{formatBytes(file.size)}</span> : null}
        {markdown ? (
          <SegmentedControl
            label="Markdown view"
            value={markdownMode}
            onValueChange={setMarkdownMode}
            items={[
              { value: 'preview', label: 'Preview' },
              { value: 'source', label: 'Source' },
            ]}
          />
        ) : null}
        {showsCode ? (
          <Button variant="ghost" size="sm" pressed={wrap} onClick={() => setWrap((w) => !w)} aria-label={wrap ? 'Disable line wrap' : 'Wrap long lines'}>
            Wrap
          </Button>
        ) : null}
        <IconButton size="sm" icon="refresh" label="Refresh" onClick={onRefresh} disabled={refreshing} />
      </div>
      <FileBody
        path={path}
        file={file}
        loading={loading}
        error={error}
        wrap={wrap}
        preview={markdown && markdownMode === 'preview'}
      />
    </div>
  );
}

function FileBody({
  path,
  file,
  loading,
  error,
  wrap,
  preview,
}: {
  path: string;
  file: WorkspaceFileContent | undefined;
  loading: boolean;
  error: unknown;
  wrap: boolean;
  /** Render markdown instead of highlighting the source. */
  preview: boolean;
}) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-small text-fg-3">
        <Spinner size={14} /> Loading…
      </div>
    );
  }
  if (error) {
    // A 404 is an ordinary race (the agent deleted the file after the tree
    // snapshot), not a fault.
    const gone = error instanceof ApiError && error.status === 404;
    return (
      <EmptyState
        icon={gone ? 'warning' : 'file'}
        tone={gone ? 'empty' : 'error'}
        title={gone ? 'This file no longer exists in the workspace.' : 'Could not load this file.'}
        description={gone ? path : error instanceof Error ? error.message : undefined}
        className="flex-1"
      />
    );
  }
  if (!file) return null;
  if (file.isBinary) {
    return <EmptyState icon="file" title={`Binary file (${formatBytes(file.size)}) — nothing to display.`} description={path} className="flex-1" />;
  }
  if (file.isTooLarge || file.contents === null) {
    return <EmptyState icon="info" title={`File is too large to preview (${formatBytes(file.size)}).`} description={path} className="flex-1" />;
  }
  if (preview) {
    return (
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <Markdown>{file.contents}</Markdown>
      </div>
    );
  }
  return (
    // DiffProviders mounts at the point of use (W28): the worker pool is a
    // ref-counted singleton, and the highlighter stays out of pages that never
    // open a file.
    <DiffProviders>
      <FileCodeView name={path} contents={file.contents} cacheKey={file.cacheKey} wrapLines={wrap} hideHeader className="min-h-0 flex-1 overflow-auto" />
    </DiffProviders>
  );
}
