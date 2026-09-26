// ────────────────────────────────────────────────────────────────
// FilesPanel — browse and read every file in the chat's sources (F-dock-02;
// boards DockFiles, ChatFiles).
//
// Deliberately not a diff: Changes answers "what changed", this answers
// "what is in here", so an untouched file still opens with highlighting and
// line numbers. One component serves both dock tabs:
//   • the pinned Files tab — Sources header (host slot), a "Files" bar (tree
//     toggle, source picker, refresh), the B-08 tree and, once a file is
//     picked, the B-09 preview beside it;
//   • a file-viewer tab (`initialFile`) — the tree starts hidden so the file
//     gets the whole dock; the toggle brings it back.
// Single click previews; double-click / Enter opens the file in its own tab.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useWorkspaceTree, useWorkspaceTreeFile } from '@/hooks/queries.js';
import { useWorkspaceInfo } from '@/hooks/sourceQueries.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuTrigger } from '@/ui/primitives/Menu/Menu.js';
import { KbdHintRow } from '@/ui/patterns/KbdHintRow/KbdHintRow.js';
import { MountFileTree, type MountTreeSection } from './MountFileTree.js';
import { FileViewer } from './FileViewer.js';
import type { FileTabRef } from './fileTabId.js';

export interface FilesPanelProps {
  workspaceId: string | undefined;
  /** Opens directly on this file with the tree hidden (a file-viewer tab). */
  initialFile?: FileTabRef;
  /** Double-click / Enter on a tree row. Omit to disable file tabs. */
  onOpenFile?: (ref: FileTabRef) => void;
  /** The previewed file changed (titles the Files tab). */
  onSelectionChange?: (ref: FileTabRef | null) => void;
  /** Leads the Files tab: the chat's Sources block (mount cards, Edit sources…). */
  sources?: ReactNode;
}

const MODE_LABEL: Record<string, string> = { worktree: 'Worktree', 'in-place': 'In place', generated: 'Generated' };

export function FilesPanel({ workspaceId, initialFile, onOpenFile, onSelectionChange, sources }: FilesPanelProps) {
  const [showTree, setShowTree] = useState(!initialFile);
  const [source, setSource] = useState<string>(initialFile?.alias ?? '*');
  const [selection, setSelection] = useState<FileTabRef | null>(initialFile ?? null);

  const treeQuery = useWorkspaceTree(workspaceId);
  const repos = useMemo(() => treeQuery.data?.repos ?? [], [treeQuery.data]);
  // The tree knows the aliases; only the workspace knows what each one IS.
  const workspaceInfo = useWorkspaceInfo(workspaceId);
  const mounts = useMemo(() => {
    const map = new Map<string, { mode: string; branch?: string }>();
    for (const m of workspaceInfo.data?.mounts ?? []) {
      map.set(m.alias, { mode: m.mode, ...(m.git?.branch ? { branch: m.git.branch } : {}) });
    }
    return map;
  }, [workspaceInfo.data]);

  const sections = useMemo<MountTreeSection[]>(
    () =>
      repos
        .filter((repo) => source === '*' || repo.alias === source)
        .map((repo) => {
          const mount = mounts.get(repo.alias);
          const subtitle = [repo.kind === 'nested' ? 'Nested repo' : mount ? MODE_LABEL[mount.mode] : undefined, mount?.branch]
            .filter(Boolean)
            .join(' · ');
          return {
            alias: repo.alias,
            title: repo.alias === '.' ? 'workspace root' : repo.alias,
            ...(subtitle ? { subtitle } : {}),
            paths: [...repo.paths].sort(),
          };
        }),
    [repos, source, mounts],
  );

  // Follow the host's file when a tab is re-pointed or restored.
  const initialAlias = initialFile?.alias;
  const initialPath = initialFile?.path;
  useEffect(() => {
    if (initialAlias && initialPath) setSelection({ alias: initialAlias, path: initialPath });
  }, [initialAlias, initialPath]);

  // Report the selection (restore and clear-on-delete too, not only clicks).
  const notify = useRef(onSelectionChange);
  useEffect(() => {
    notify.current = onSelectionChange;
  }, [onSelectionChange]);
  useEffect(() => {
    notify.current?.(selection);
  }, [selection]);

  // Drop a Files-tab selection that no longer exists (source switched, file
  // deleted). A file tab keeps its file so the viewer can say what happened.
  useEffect(() => {
    if (initialFile || !selection || treeQuery.isLoading) return;
    const section = sections.find((s) => s.alias === selection.alias);
    if (sections.length === 0 || (section && section.paths.includes(selection.path))) return;
    setSelection(null);
  }, [sections, selection, initialFile, treeQuery.isLoading]);

  const file = useWorkspaceTreeFile(workspaceId, selection?.path, { alias: selection?.alias ?? '.' }, !!selection);

  const activate = useCallback(
    (ref: FileTabRef) => {
      setSelection(ref);
      onOpenFile?.(ref);
    },
    [onOpenFile],
  );

  const refresh = useCallback(() => {
    void treeQuery.refetch();
    // `refetch()` ignores `enabled`: without a selection it would ask for "undefined".
    if (selection) void file.refetch();
  }, [treeQuery, file, selection]);

  if (!workspaceId) {
    return <EmptyState icon="files" title="No workspace yet" description="Files appear once the agent starts working." className="h-full" />;
  }

  const treeToggle = (
    <IconButton
      size="sm"
      icon="sidebar"
      label={showTree ? 'Hide file tree' : 'Show file tree'}
      aria-pressed={showTree}
      onClick={() => setShowTree((v) => !v)}
    />
  );
  const truncated = repos.some((r) => r.truncated);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {sources && !initialFile ? <div className="shrink-0 border-b border-line-soft">{sources}</div> : null}
      {selection ? null : (
        <div className="flex h-panel-bar shrink-0 items-center gap-1.5 border-b border-line-soft px-2">
          {treeToggle}
          <span className="min-w-0 flex-1 truncate text-ui text-fg-2">Files</span>
          {repos.length > 1 ? <SourcePicker repos={repos.map((r) => r.alias)} value={source} onChange={(next) => { setSource(next); setSelection(null); }} /> : null}
          <IconButton size="sm" icon="refresh" label="Refresh" onClick={refresh} disabled={treeQuery.isRefetching} />
        </div>
      )}
      {truncated ? (
        <Callout tone="warn" className="shrink-0 rounded-none border-x-0 border-t-0">
          This repository has more files than can be listed; the tree is truncated.
        </Callout>
      ) : null}
      <div className="flex min-h-0 flex-1">
        {showTree ? (
          <div className={selection ? 'flex w-60 shrink-0 flex-col border-r border-line-soft' : 'flex min-w-0 flex-1 flex-col'}>
            <MountFileTree
              sections={sections}
              loading={treeQuery.isLoading}
              selection={selection}
              onSelect={setSelection}
              {...(onOpenFile ? { onActivate: activate } : {})}
            />
          </div>
        ) : null}
        {selection ? (
          <FileViewer
            path={selection.path}
            {...(repos.length > 1 ? { alias: selection.alias } : {})}
            file={file.data}
            loading={file.isLoading}
            error={file.error}
            onRefresh={refresh}
            refreshing={treeQuery.isRefetching}
            leading={treeToggle}
          />
        ) : null}
      </div>
      {!selection && onOpenFile ? (
        <div className="flex h-step shrink-0 items-center border-t border-line-soft px-3">
          <KbdHintRow hints={[{ keys: 'Click', label: 'to preview' }, { keys: '↵', label: 'or double-click to open in its own tab' }]} />
        </div>
      ) : null}
    </div>
  );
}

function SourcePicker({ repos, value, onChange }: { repos: string[]; value: string; onChange: (next: string) => void }) {
  const label = value === '*' ? `All sources (${repos.length})` : value === '.' ? 'workspace root' : value;
  return (
    <MenuRoot>
      <MenuTrigger
        render={
          <Button variant="secondary" size="sm" trailingIcon="chevron-down" aria-label={`Source: ${label}`}>
            {label}
          </Button>
        }
      />
      <MenuPopup align="end">
        <MenuRadioGroup value={value} onValueChange={(next: unknown) => onChange(String(next))}>
          <MenuRadioItem value="*">{`All sources (${repos.length})`}</MenuRadioItem>
          {repos.map((alias) => (
            <MenuRadioItem key={alias} value={alias}>
              {alias === '.' ? 'workspace root' : alias}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </MenuRoot>
  );
}
