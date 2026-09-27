// ────────────────────────────────────────────────────────────────
// useFileTabs + the Files dock panels (F-dock-02; D-27: one pinned Files tab,
// file-viewer tabs ≤ 8).
//
// The file tab id IS the file reference (`fileTabId`): re-opening a file
// focuses its tab, restored tabs know their file, closing one leaves nothing
// to clean up. The previewed file per Files tab titles it "Files · name".
//
// Hosting: register `FilesDockPanel` / `FileDockPanel` as `Component`s of the
// kit dock (`blocks/dock`) under a `<FilesDockProvider value={fileTabs.dockContext}>`
// — the panels read everything from the context, so a page re-render reaches
// no panel whose props did not change (the chat and the run page).
// ────────────────────────────────────────────────────────────────

import { createContext, lazy, memo, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { DockPanelProps } from '@/blocks/dock/dockRegistry.js';
import { useActivated } from '@/blocks/dock/useActivated.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { fileTabId, fileTabLabel, parseFileTabId, type FileTabRef } from './fileTabId.js';

// The tree (@pierre/trees) and the highlighter (@pierre/diffs + Shiki) are
// never on the path to a page's first paint: the panels load them on mount.
const FilesPanel = lazy(() => import('./FilesPanel.js').then((m) => ({ default: m.FilesPanel })));

function PanelFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner size={16} label="Loading" />
    </div>
  );
}

/** What the Files dock panels read from their provider. */
export interface FilesDockContextValue {
  workspaceId: string | undefined;
  openFile: (ref: FileTabRef) => void;
  setPreview: (tabId: string, ref: FileTabRef | null) => void;
  /** Leads the Files tab: the Sources block (mount cards, Edit sources…). */
  sources?: ReactNode;
}

const FilesDockContext = createContext<FilesDockContextValue | null>(null);
export const FilesDockProvider = FilesDockContext.Provider;

function useFilesDock(): FilesDockContextValue {
  const value = useContext(FilesDockContext);
  if (!value) throw new Error('Files dock panels need a <FilesDockProvider>');
  return value;
}

/** The pinned Files tab: sources, tree, preview. */
export const FilesDockPanel = memo(function FilesDockPanel({ id, active }: DockPanelProps) {
  const { workspaceId, openFile, setPreview, sources } = useFilesDock();
  const onSelectionChange = useCallback((ref: FileTabRef | null) => setPreview(id, ref), [setPreview, id]);
  // The pinned Files tab loads the tree when first shown, not with the page.
  const activated = useActivated(active);
  if (!activated) return null;
  return (
    <Suspense fallback={<PanelFallback />}>
      <FilesPanel
        workspaceId={workspaceId}
        onOpenFile={openFile}
        onSelectionChange={onSelectionChange}
        {...(sources ? { sources } : {})}
      />
    </Suspense>
  );
});

/** A file-viewer tab: the file whose ref its id encodes, tree hidden. */
export const FileDockPanel = memo(function FileDockPanel({ id }: DockPanelProps) {
  const { workspaceId, openFile } = useFilesDock();
  return <FileTabBody id={id} workspaceId={workspaceId} onOpenFile={openFile} />;
});

function FileTabBody({
  id,
  workspaceId,
  onOpenFile,
}: {
  id: string;
  workspaceId: string | undefined;
  onOpenFile: (ref: FileTabRef) => void;
}) {
  const ref = parseFileTabId(id);
  if (!ref) return <EmptyState icon="file" title="This tab is no longer pointing at a file." className="h-full" />;
  return (
    <Suspense fallback={<PanelFallback />}>
      <FilesPanel workspaceId={workspaceId} initialFile={ref} onOpenFile={onOpenFile} />
    </Suspense>
  );
}

export interface UseFileTabsOptions {
  workspaceId: string | undefined;
  /** The host's "focus this dock tab" request. */
  requestFocus: (request: { type: string; token: number; tabId?: string }) => void;
  /** Opens a collapsed dock first, so the gesture always shows the file. */
  openPane?: () => void;
  sources?: ReactNode;
}

export interface UseFileTabsResult {
  /** Opens (or focuses) the file-viewer tab showing `ref`. */
  openFile: (ref: FileTabRef) => void;
  /** Forget a closed Files tab's remembered preview. */
  forgetTab: (tabId: string) => void;
  /** Files-tab label: "Files", or "Files · name" while previewing. */
  filesTabLabel: (tab: { id: string }) => string;
  /** File-viewer tab label: the file name. */
  fileTabLabel: (tab: { id: string }) => string;
  /** The value for `<FilesDockProvider>`. */
  dockContext: FilesDockContextValue;
}

export function useFileTabs({
  workspaceId,
  requestFocus,
  openPane,
  sources,
}: UseFileTabsOptions): UseFileTabsResult {
  const [previewByTab, setPreviewByTab] = useState<Record<string, FileTabRef | null>>({});

  const forgetTab = useCallback((tabId: string) => {
    setPreviewByTab((prev) => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  const setPreview = useCallback((tabId: string, ref: FileTabRef | null) => {
    setPreviewByTab((prev) => (prev[tabId] === ref ? prev : { ...prev, [tabId]: ref }));
  }, []);

  const openFile = useCallback(
    (ref: FileTabRef) => {
      openPane?.();
      requestFocus({ type: 'file', token: Date.now(), tabId: fileTabId(ref) });
    },
    [requestFocus, openPane],
  );

  const filesTabLabel = useCallback(
    ({ id }: { id: string }) => {
      const ref = previewByTab[id];
      return ref ? `Files · ${ref.path.split('/').pop() ?? ref.path}` : 'Files';
    },
    [previewByTab],
  );
  const fileLabel = useCallback(({ id }: { id: string }) => fileTabLabel(id) ?? 'File', []);

  const dockContext = useMemo<FilesDockContextValue>(
    () => ({
      workspaceId,
      openFile,
      setPreview,
      ...(sources ? { sources } : {}),
    }),
    [workspaceId, openFile, setPreview, sources],
  );

  return { openFile, forgetTab, filesTabLabel, fileTabLabel: fileLabel, dockContext };
}
