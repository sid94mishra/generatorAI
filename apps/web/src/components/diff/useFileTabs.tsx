// ────────────────────────────────────────────────────────────────
// useFileTabs — "open this file in its own right-pane tab"
// ────────────────────────────────────────────────────────────────
//
// Both the chat page and the run page offer the same gesture, and getting it
// right involves a few non-obvious details (deterministic tab ids, labels and
// icons derived from the id, opening the pane if it is collapsed). Keeping it
// here means neither page re-implements them, and they cannot drift apart.

import { useCallback, useState } from 'react';
import { FolderTree } from 'lucide-react';
import { FileTypeIcon } from '@/components/shared/fileIcons.js';
import type { RightPaneTabDef } from '@/components/layout/RightPane.js';
import { SourcesPanel } from '@/components/chat/sources/SourcesPanel.js';
import { FilesSurface } from './FilesSurface.js';
import { fileTabId, fileTabLabel, parseFileTabId, type FileTabRef } from './fileTabId.js';

export interface UseFileTabsOptions {
  workspaceId: string | undefined;
  /** Same setter the page uses for RightPane's `focusTabRequest`. */
  requestFocus: (request: { type: string; token: number; tabId?: string }) => void;
  /** Called before focusing, so a collapsed pane opens with the file. */
  openPane?: () => void;
  /**
   * Opens the chat's source editor. When given, the Files tab leads with a
   * "Sources" block listing the mounts — the answer to "which of these
   * folders am I looking at?" belongs next to the tree, not two tabs away.
   */
  onEditSources?: (() => void) | undefined;
}

export interface UseFileTabsResult {
  /** Opens (or focuses) the tab showing `ref`. */
  openFile: (ref: FileTabRef) => void;
  /** The browsable "Files" tab. Offer this one in `addableTabTypes`. */
  filesTab: RightPaneTabDef;
  /** The per-file tab kind. Register it, but never offer it in the menu. */
  fileTab: RightPaneTabDef;
  /** Forget a Files tab's remembered selection when the tab is closed. */
  forgetTab: (tabId: string) => void;
}

export function useFileTabs({
  workspaceId,
  requestFocus,
  openPane,
  onEditSources,
}: UseFileTabsOptions): UseFileTabsResult {
  /**
   * Previewed file per Files-tab instance, so each tab can be titled after
   * what it is showing.
   *
   * Keyed by tab id rather than held as a single value because Files tabs are
   * multi-instance: browsing in one must not retitle another. The surfaces
   * themselves already keep separate state (RightPane mounts every panel), so
   * this only mirrors what each one reports.
   */
  const [previewByTab, setPreviewByTab] = useState<Record<string, FileTabRef | null>>({});

  const forgetTab = useCallback((tabId: string) => {
    setPreviewByTab((prev) => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  const openFile = useCallback(
    (ref: FileTabRef) => {
      openPane?.();
      // The id encodes the file, so re-opening the same file focuses the tab
      // already showing it instead of stacking duplicates.
      requestFocus({ type: 'file', token: Date.now(), tabId: fileTabId(ref) });
    },
    [requestFocus, openPane],
  );

  return {
    openFile,
    forgetTab,
    filesTab: {
      label: 'Files',
      description: 'Browse every file in the workspace',
      icon: <FolderTree className="h-3.5 w-3.5" />,
      // Multi-instance so two files can be browsed side by side across tabs;
      // each keeps its own selection and title.
      allowMultiple: true,
      maxInstances: 4,
      disabled: !workspaceId,
      disabledReason: 'No workspace for this chat',
      // Titled after what it previews, but always recognisably the BROWSER:
      // "Files · money.js" under the folder icon. It used to take the file's
      // bare name and its icon, so double-clicking a file (the first click
      // previews it, the second opens its own tab) left two identical
      // "money.js" tabs side by side — one of them secretly the file tree.
      getTabLabel: ({ id, index }) => {
        const base = index <= 1 ? 'Files' : `Files ${index}`;
        const ref = previewByTab[id];
        return ref ? `${base} · ${ref.path.split('/').pop() ?? ref.path}` : base;
      },
      getTabIcon: () => <FolderTree className="h-3.5 w-3.5" />,
      render: (ctx) => (
        <div className="flex h-full min-h-0 flex-col">
          <SourcesPanel
            embedded
            workspaceId={workspaceId}
            {...(onEditSources ? { onEditSources } : {})}
            className="shrink-0 border-b border-border"
          />
          <div className="min-h-0 flex-1">
            <FilesSurface
              embedded
              workspaceId={workspaceId}
              onOpenFile={openFile}
              onSelectionChange={(ref) =>
                setPreviewByTab((prev) => (prev[ctx.id] === ref ? prev : { ...prev, [ctx.id]: ref }))
              }
            />
          </div>
        </div>
      ),
    },
    fileTab: {
      // Never offered in the "+" menu — a file tab only exists because a
      // specific file was opened, so an empty one would be meaningless.
      label: 'File',
      icon: <FileTypeIcon name="file.txt" className="h-3.5 w-3.5" />,
      allowMultiple: true,
      maxInstances: 8,
      getTabLabel: ({ id }) => fileTabLabel(id) ?? 'File',
      getTabIcon: ({ id }) => (
        <FileTypeIcon name={fileTabLabel(id) ?? 'file.txt'} className="h-3.5 w-3.5" />
      ),
      render: (ctx) => {
        const ref = parseFileTabId(ctx.id);
        if (!ref) {
          return (
            <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
              This tab is no longer pointing at a file.
            </div>
          );
        }
        return (
          <FilesSurface
            embedded
            workspaceId={workspaceId}
            initialFile={ref}
            onOpenFile={openFile}
          />
        );
      },
    },
  };
}
