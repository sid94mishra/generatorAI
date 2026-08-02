// ────────────────────────────────────────────────────────────────
// FileCodeView — virtualized, syntax-highlighted plain file viewer
// ────────────────────────────────────────────────────────────────
//
// The diff viewer's sibling for "just show me this file". Uses Pierre's
// `type: 'file'` item rather than a synthetic diff: passing a file as
// `old=null, new=contents` would render every line as a green addition, which
// is wrong when nothing was added — the user is browsing, not reviewing.
//
// Shares the worker pool and theme with DiffCodeView (both live under
// <DiffProviders>), so highlighting is consistent across the app and an
// already-highlighted file is a cache hit rather than re-work.

import { useMemo } from 'react';
import { CodeView } from '@pierre/diffs/react';
import type { CodeViewItem } from '@pierre/diffs';
import { useTheme } from '@/providers/ThemeProvider.js';
import { DIFF_THEMES, DIFF_UNSAFE_CSS, diffHostStyle } from './diffTheme.js';

export interface FileCodeViewProps {
  /** Path or filename — drives the header and the inferred language. */
  name: string;
  contents: string;
  /**
   * Must change whenever `name` or `contents` change, or the worker pool
   * will serve a stale highlight for the previous file.
   */
  cacheKey?: string;
  wrapLines?: boolean;
  /**
   * Hide the viewer's built-in filename header. Set this when the host
   * already renders one, otherwise the filename appears twice.
   */
  hideHeader?: boolean;
  className?: string;
  style?: React.CSSProperties;
  emptyState?: React.ReactNode;
}

export function FileCodeView({
  name,
  contents,
  cacheKey,
  wrapLines = false,
  hideHeader = false,
  className,
  style,
  emptyState,
}: FileCodeViewProps) {
  const { resolvedTheme } = useTheme();

  const items = useMemo<CodeViewItem[]>(() => {
    if (!name) return [];
    return [
      {
        id: name,
        type: 'file',
        file: {
          name,
          contents,
          // Fall back to path+length: without a cacheKey the pool re-highlights
          // on every render; with a wrong one it shows the previous file.
          cacheKey: cacheKey ?? `${name}:${contents.length}`,
        },
      },
    ];
  }, [name, contents, cacheKey]);

  if (items.length === 0) {
    return <>{emptyState ?? null}</>;
  }

  return (
    <CodeView
      // Keyed by file so switching selection remounts rather than trying to
      // reconcile two unrelated documents.
      key={name}
      items={items}
      className={className}
      style={{ ...diffHostStyle, ...style }}
      options={{
        theme: DIFF_THEMES,
        themeType: resolvedTheme,
        unsafeCSS: DIFF_UNSAFE_CSS,
        overflow: wrapLines ? 'wrap' : 'scroll',
        disableFileHeader: hideHeader,
        stickyHeaders: !hideHeader,
        layout: { paddingTop: 8, paddingBottom: 24, gap: 10 },
      }}
    />
  );
}
