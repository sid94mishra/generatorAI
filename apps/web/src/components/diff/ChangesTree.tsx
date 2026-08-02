// ────────────────────────────────────────────────────────────────
// ChangesTree — virtualized, path-first file tree with git status
// ────────────────────────────────────────────────────────────────
//
// Wraps @pierre/trees `FileTree`. Chosen over the previous hand-rolled tree
// because it virtualizes rows (a generated repo can easily have thousands of
// files) and ships a first-class git-status lane that rolls changed
// descendants up to their folders — exactly the badge behaviour we want.
//
// Kept behind this façade deliberately: @pierre/trees is still 1.0.0-beta,
// so if we ever need to swap it out, only this file changes. The façade also
// carries the two behaviours the library does not expose (row activation and
// a custom search placeholder), so callers never touch its shadow DOM.

import { useEffect, useMemo, useRef } from 'react';
import { FileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react';
import { cn } from '@/lib/utils.js';
import { FILE_ICON_SET } from '@/components/shared/fileIcons.js';
import { useTheme } from '@/providers/ThemeProvider.js';
import { treeHostStyleFor } from './diffTheme.js';

export type TreeGitStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'ignored';

/**
 * Overrides for the library's git-status painting.
 *
 * Out of the box `[data-item-git-status]` recolours the row's ICON and its
 * FILENAME with the status colour. That is two problems at once: the
 * filename stops being plain text (a tree of changes becomes a wall of
 * green/amber/red, which is harder to scan, not easier) and the file-type
 * icon loses the very thing that makes it recognisable — its own brand
 * colour. A `.ts` icon that is green because the file was added is not a
 * `.ts` icon any more.
 *
 * So: the status colour is confined to the dedicated git lane (the A/M/D
 * marker), which is exactly the affordance that is supposed to carry it, and
 * which we colour-match to the diff rows.
 *
 * `unsafeCSS` is the library's own escape hatch and lands in `@layer unsafe`,
 * declared after `@layer base`, so these win regardless of specificity
 * without any `!important`. It is explicitly not covered by the library's
 * compatibility guarantees, so everything here degrades to "the library's
 * default look" rather than to a broken tree if the markup ever changes.
 */
const TREE_STATUS_CSS = `
  [data-item-git-status] > [data-item-section="content"] {
    color: var(--trees-fg);
  }
  [data-item-git-status] > [data-item-section="icon"] > :not([data-icon-name="file-tree-icon-chevron"]) {
    color: var(--trees-fg-muted);
  }
  [data-file-tree-colored-icons="true"] [data-item-git-status] > [data-item-section="icon"] > [data-icon-token] {
    color: revert-layer;
  }
`;

/**
 * Real, per-file-type icons rather than one generic glyph.
 *
 * Imported rather than declared here so the tree and the React-rendered
 * icons (tabs, diff rows, file headers) resolve from the SAME set — they
 * share the sprite, so a `.ts` file cannot end up as two different glyphs
 * depending on which surface is drawing it. `colored` is what restores each
 * language's own brand colour; the rule set above then keeps git status
 * from painting over it.
 */
const TREE_ICONS = FILE_ICON_SET;

export interface ChangesTreeProps {
  /** Every path to show, repo-relative. */
  paths: string[];
  /** Git status per path — folders inherit from their descendants. */
  gitStatus?: Array<{ path: string; status: TreeGitStatus }>;
  /**
   * Colour per status for the git lane, so the tree's A/M/D marker matches
   * whatever the calling surface paints on its own rows.
   */
  statusColors?: Partial<Record<TreeGitStatus, string>>;
  /** Path to reveal + focus (e.g. the file open in the diff pane). */
  activePath?: string | null;
  /** Single click / arrow-key focus. */
  onSelect?: (path: string) => void;
  /** Double-click or ⏎ — the "open this properly" gesture. */
  onActivate?: (path: string) => void;
  search?: boolean;
  /** Overrides the library's built-in "Search…" placeholder. */
  searchPlaceholder?: string;
  className?: string;
  style?: React.CSSProperties;
  header?: React.ReactNode;
}

export function ChangesTree({
  paths,
  gitStatus,
  statusColors,
  activePath,
  onSelect,
  onActivate,
  search = true,
  searchPlaceholder,
  className,
  style,
  header,
}: ChangesTreeProps) {
  const { resolvedTheme } = useTheme();
  const hostStyle = useMemo(
    () => ({
      ...treeHostStyleFor(resolvedTheme),
      ...(statusColors?.added ? { '--trees-git-added-color-override': statusColors.added } : {}),
      ...(statusColors?.modified
        ? { '--trees-git-modified-color-override': statusColors.modified }
        : {}),
      ...(statusColors?.deleted
        ? { '--trees-git-deleted-color-override': statusColors.deleted }
        : {}),
      ...(statusColors?.renamed
        ? { '--trees-git-renamed-color-override': statusColors.renamed }
        : {}),
      ...(statusColors?.untracked
        ? { '--trees-git-untracked-color-override': statusColors.untracked }
        : {}),
    }),
    [
      resolvedTheme,
      statusColors?.added,
      statusColors?.modified,
      statusColors?.deleted,
      statusColors?.renamed,
      statusColors?.untracked,
    ],
  );

  // The model is created ONCE for the component's lifetime — later option
  // changes do not reconfigure it. All updates go through model methods.
  const { model } = useFileTree({
    paths,
    search,
    initialExpansion: 'open',
    // Collapse `a/b/c` chains with a single child into one row, which is what
    // makes deep generated trees readable.
    flattenEmptyDirectories: true,
    density: 'compact',
    icons: TREE_ICONS,
    unsafeCSS: TREE_STATUS_CSS,
  });

  const selectedPaths = useFileTreeSelection(model);
  const lastSelected = useRef<string | null>(null);
  /**
   * Wrapper element, NOT the tree host: `FileTree` applies its own `ref`
   * after spreading host props, so a `ref` passed to it is discarded.
   * Listening one level up is equivalent — the events we want bubble, and
   * `composedPath()` still reaches through the shadow boundary.
   */
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Push new path lists into the existing model rather than remounting, so
  // expansion state and scroll position survive an agent writing new files.
  const pathKey = useMemo(() => paths.join('\u0000'), [paths]);
  useEffect(() => {
    model.resetPaths(paths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, pathKey]);

  const statusKey = useMemo(
    () => (gitStatus ?? []).map((s) => `${s.path}:${s.status}`).join('\u0000'),
    [gitStatus],
  );
  useEffect(() => {
    model.setGitStatus(gitStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, statusKey]);

  // Selection is owned by the tree; mirror it outward without echoing back.
  useEffect(() => {
    const next = selectedPaths[0];
    if (!next || next === lastSelected.current) return;
    lastSelected.current = next;
    onSelect?.(next);
  }, [selectedPaths, onSelect]);

  // Reveal the externally-driven active path (e.g. a file picked in the diff
  // pane). The tree's own `select()` ADDS to the selection, so every path we
  // had ever revealed stayed highlighted; the previous selection is cleared
  // explicitly to keep this a single-selection tree.
  useEffect(() => {
    if (activePath === lastSelected.current) return;
    lastSelected.current = activePath ?? null;
    for (const path of model.getSelectedPaths()) {
      if (path !== activePath) model.getItem(path)?.deselect();
    }
    if (!activePath) return;
    model.scrollToPath(activePath, { offset: 'nearest', focus: false });
    model.getItem(activePath)?.select();
  }, [model, activePath]);

  /**
   * Row activation. The library has no `onActivate`, so we listen on the host
   * and recover the row from `composedPath()` — shadow-DOM events retarget to
   * the host, but the composed path still carries the inner element.
   */
  const onActivateRef = useRef(onActivate);
  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);

  useEffect(() => {
    const host = wrapperRef.current;
    if (!host) return;

    const pathFromEvent = (e: Event): string | null => {
      for (const target of e.composedPath()) {
        if (!(target instanceof HTMLElement)) continue;
        const path = target.dataset['itemPath'];
        if (path) return path;
      }
      return null;
    };

    const onDblClick = (e: Event) => {
      const path = pathFromEvent(e);
      if (path) onActivateRef.current?.(path);
    };
    const onKeyDown = (e: Event) => {
      if (!(e instanceof KeyboardEvent) || e.key !== 'Enter') return;
      // Never hijack ⏎ inside the search box — there it means "next match".
      for (const target of e.composedPath()) {
        if (target instanceof HTMLInputElement) return;
      }
      const path = pathFromEvent(e);
      if (path) onActivateRef.current?.(path);
    };

    host.addEventListener('dblclick', onDblClick);
    host.addEventListener('keydown', onKeyDown);
    return () => {
      host.removeEventListener('dblclick', onDblClick);
      host.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  /**
   * The search placeholder is hardcoded in the library, so it is patched on
   * the rendered input.
   *
   * The input is created inside a shadow root during the tree's own render,
   * which can land after this effect, so a one-shot query misses it. A
   * MutationObserver covers both orders and also survives the tree
   * re-rendering its chrome. Deliberately best-effort: if a future version
   * changes the markup this silently keeps the library's own placeholder
   * rather than breaking the tree.
   */
  useEffect(() => {
    if (!searchPlaceholder) return;
    const host = wrapperRef.current?.querySelector('file-tree-container');
    const root = host?.shadowRoot;
    if (!root) return;

    const apply = () => {
      const input = root.querySelector<HTMLInputElement>('[data-file-tree-search-input]');
      if (input && input.placeholder !== searchPlaceholder) {
        input.placeholder = searchPlaceholder;
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [searchPlaceholder]);

  return (
    // `pt-2` compensates for the library's `[data-file-tree-search-container]
    // { padding: 0 }`, which leaves the search input flush against the top
    // edge. Padding the wrapper is safer than overriding shadow-DOM CSS.
    <div ref={wrapperRef} className={cn('changes-tree pt-2', className)} style={style}>
      <FileTree
        model={model}
        style={{ ...hostStyle, height: '100%', minHeight: 0 }}
        {...(header ? { header } : {})}
      />
    </div>
  );
}
