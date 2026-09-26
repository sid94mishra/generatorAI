// ────────────────────────────────────────────────────────────────
// B-08 FileTree — virtualized, path-first file tree with change letters
// (03-domain §2.2). Wraps @pierre/trees `FileTree`.
//
// Chosen over a hand-rolled tree because it virtualizes rows (a generated
// repo can easily have thousands of files) and ships a git-status lane that
// rolls changed descendants up to their folders. It stays behind this façade
// (the library is 1.0 beta): the façade adds what the library does not expose
// — row activation (double-click / Enter), the filter placeholder, `/` to
// focus the filter — so callers never touch its shadow-root DOM.
//
// Status letters and tones come from the one shared map (`CHANGE_KIND`,
// packages/shared): A ok · M warn · D err · R run · U fg-3. The status colour
// stays in the git lane; file names stay plain text.
//
// P4-09 builds what the Changes dock needs (one tree of display paths — with
// several mounts the alias is the top folder). Per-mount section headers and
// the compact tray variant arrive with their consumers (Files dock, composer
// tray).
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { FileTree as PierreFileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react';
import { CHANGE_KIND, type ChangeKindTone, type ChangeKindValue } from '@generatorai/shared';
import { cn } from '@/ui/lib/cn.js';
import { treeHostStyleFor } from '@/blocks/diff/diffTheme.js';
import { useDocumentAppearance } from '@/blocks/diff/useDocumentAppearance.js';

/** Statuses the tree's git lane understands (`removed` renders as `deleted`). */
export type FileTreeStatus = Exclude<ChangeKindValue, 'removed'>;

export interface FileTreeStatusEntry {
  path: string;
  status: FileTreeStatus;
}

export interface FileTreeProps {
  /** Every path to show (display paths: alias-prefixed with several mounts). */
  paths: readonly string[];
  /** Change status per path — folders inherit from their descendants. */
  statuses?: readonly FileTreeStatusEntry[];
  /** Path to reveal + select (e.g. the file open in the diff). */
  activePath?: string | null;
  /** Single click / arrow-key selection. */
  onSelect?: (path: string) => void;
  /** Double-click or Enter — "open this properly". */
  onActivate?: (path: string) => void;
  /** Show the filter input (default on). */
  filter?: boolean;
  /** Placeholder of the filter input. */
  filterPlaceholder?: string;
  className?: string;
}

/** One glyph set for every tree; monochrome like the rest of the kit's icons. */
const TREE_ICONS = { set: 'complete', colored: false } as const;

/**
 * The library paints a changed row's icon AND name in the status colour by
 * default, which turns a list of changes into a wall of colour. Confine the
 * colour to the git lane (the letter). `unsafeCSS` lands in the library's last
 * layer, so these win without `!important`; if its markup ever changes the
 * failure mode is only "the library's default look".
 */
const TREE_STATUS_CSS = `
  [data-item-git-status] > [data-item-section="content"] {
    color: var(--trees-fg);
  }
  [data-item-git-status] > [data-item-section="icon"] > :not([data-icon-name="file-tree-icon-chevron"]) {
    color: var(--trees-fg-muted);
  }
`;

/** Tone → the raw token the tree's git lane is painted with. */
const TONE_VAR: Record<ChangeKindTone, string> = {
  ok: 'var(--gai-ok)',
  warn: 'var(--gai-warn)',
  err: 'var(--gai-err)',
  run: 'var(--gai-run)',
  'fg-3': 'var(--gai-fg-3)',
};

/** The shared letter tones, handed to the tree as its git-lane colours. */
const STATUS_COLOR_STYLE = {
  '--trees-git-added-color-override': TONE_VAR[CHANGE_KIND.added.tone],
  '--trees-git-modified-color-override': TONE_VAR[CHANGE_KIND.modified.tone],
  '--trees-git-deleted-color-override': TONE_VAR[CHANGE_KIND.deleted.tone],
  '--trees-git-renamed-color-override': TONE_VAR[CHANGE_KIND.renamed.tone],
  '--trees-git-untracked-color-override': TONE_VAR[CHANGE_KIND.untracked.tone],
} as CSSProperties;

export function FileTree({
  paths,
  statuses,
  activePath,
  onSelect,
  onActivate,
  filter = true,
  filterPlaceholder,
  className,
}: FileTreeProps) {
  const resolvedTheme = useDocumentAppearance();
  const hostStyle = useMemo<CSSProperties>(
    () => ({ ...treeHostStyleFor(resolvedTheme), ...STATUS_COLOR_STYLE, height: '100%', minHeight: 0 }),
    [resolvedTheme],
  );

  // The model is created ONCE for the component's lifetime; later updates go
  // through its methods.
  const { model } = useFileTree({
    paths: [...paths],
    search: filter,
    initialExpansion: 'open',
    // Collapse single-child `a/b/c` chains into one row.
    flattenEmptyDirectories: true,
    density: 'compact',
    icons: TREE_ICONS,
    unsafeCSS: TREE_STATUS_CSS,
  });

  const selectedPaths = useFileTreeSelection(model);
  const lastSelected = useRef<string | null>(null);
  /**
   * The wrapper, NOT the tree host: the library applies its own `ref` after
   * spreading host props. Events bubble here and `composedPath()` still
   * reaches through the shadow-root boundary.
   */
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // New paths go into the existing model (no remount), so expansion and
  // scroll survive an agent writing new files.
  const pathKey = paths.join('\u0000');
  useEffect(() => {
    model.resetPaths([...paths]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, pathKey]);

  const statusKey = (statuses ?? []).map((s) => `${s.path}:${s.status}`).join('\u0000');
  useEffect(() => {
    model.setGitStatus(statuses ? statuses.map((s) => ({ path: s.path, status: s.status })) : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, statusKey]);

  // Selection is owned by the tree; mirror it outward without echoing back.
  useEffect(() => {
    const next = selectedPaths[0];
    if (!next || next === lastSelected.current) return;
    lastSelected.current = next;
    onSelect?.(next);
  }, [selectedPaths, onSelect]);

  // Reveal the externally driven active path. The tree's `select()` ADDS to
  // the selection, so the previous one is cleared to keep a single selection.
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

  const onActivateRef = useRef(onActivate);
  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);

  // Activation (double-click / Enter) and `/` to focus the filter. The
  // library has neither, so listen on the wrapper and recover the row from
  // `composedPath()`.
  useEffect(() => {
    const host = wrapperRef.current;
    if (!host) return undefined;
    const pathFromEvent = (e: Event): string | null => {
      for (const target of e.composedPath()) {
        if (!(target instanceof HTMLElement)) continue;
        const path = target.dataset['itemPath'];
        if (path) return path;
      }
      return null;
    };
    const inInput = (e: Event) => e.composedPath().some((t) => t instanceof HTMLInputElement);
    const onDblClick = (e: Event) => {
      const path = pathFromEvent(e);
      if (path) onActivateRef.current?.(path);
    };
    const onKeyDown = (e: Event) => {
      if (!(e instanceof KeyboardEvent)) return;
      if (e.key === '/' && !inInput(e)) {
        const input = host
          .querySelector('file-tree-container')
          ?.shadowRoot?.querySelector<HTMLInputElement>('[data-file-tree-search-input]');
        if (input) {
          e.preventDefault();
          input.focus();
        }
        return;
      }
      // Enter inside the filter means "next match"; never hijack it.
      if (e.key !== 'Enter' || inInput(e)) return;
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

  // The filter placeholder is hard-coded in the library; patch the rendered
  // input. It is created inside the shadow-root during the tree's own render,
  // possibly after this effect, so a MutationObserver covers both orders.
  useEffect(() => {
    if (!filterPlaceholder) return undefined;
    const root = wrapperRef.current?.querySelector('file-tree-container')?.shadowRoot;
    if (!root) return undefined;
    const apply = () => {
      const input = root.querySelector<HTMLInputElement>('[data-file-tree-search-input]');
      if (input && input.placeholder !== filterPlaceholder) input.placeholder = filterPlaceholder;
      if (input && !input.getAttribute('aria-label')) input.setAttribute('aria-label', filterPlaceholder);
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [filterPlaceholder]);

  return (
    // `pt-2`: the library leaves its filter input flush with the top edge.
    <div ref={wrapperRef} className={cn('h-full min-h-0 pt-2', className)}>
      <PierreFileTree model={model} style={hostStyle} />
    </div>
  );
}
