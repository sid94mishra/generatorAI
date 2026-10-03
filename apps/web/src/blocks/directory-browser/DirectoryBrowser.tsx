// ────────────────────────────────────────────────────────────────
// DirectoryBrowser — pick a folder on the SERVER host without typing a path
// (P5-03; the chat SourcePicker and the Projects forms share it, so it is a
// block) on the kit Dialog.
//
// Backed by `GET /api/fs/dirs`, which lists directories only (never file
// contents) and is gated to local / administrative sessions server-side. A
// pasted path still works — it is often the fastest way in, and the only one
// for a folder the listing refuses to walk (permissions, a slow share).
// Browsing, not the OS picker: the path must mean something on the server,
// which the browser's own file dialog answers for the wrong machine whenever
// the two differ.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useFsDirs } from '@/hooks/sourceQueries.js';
import type { IconConcept } from '@/ui/icons/index.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Dialog, DialogBody, DialogFooter } from '@/ui/primitives/Dialog/Dialog.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';

export interface DirectoryBrowserProps {
  open: boolean;
  onClose: () => void;
  /** Fires with an absolute path when the user commits to a folder. */
  onPick: (path: string) => void;
  /** Where to open. Defaults to the roots listing. */
  initialPath?: string;
  /** One sentence under the title. */
  description?: string;
}

/** A dialog that walks the server's directories and returns the chosen absolute path. */
export function DirectoryBrowser({ open, onClose, onPick, initialPath, description }: DirectoryBrowserProps) {
  /** `''` is a real value — the roots listing — so "closed" is `null`. */
  const [path, setPath] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open) return;
    setPath(initialPath ?? '');
    setTyped(initialPath ?? '');
  }, [open, initialPath]);

  const listing = useFsDirs(open ? path : null);
  const data = listing.data;

  const goto = useCallback((next: string) => {
    setPath(next);
    setTyped(next);
  }, []);

  const pick = useCallback(
    (chosen: string) => {
      if (!chosen) return;
      onPick(chosen);
      onClose();
    },
    [onPick, onClose],
  );

  const errorMessage =
    listing.error instanceof Error ? listing.error.message : listing.error ? String(listing.error) : null;
  const entries = data?.entries ?? [];
  const roots = data?.roots ?? [];
  // The example follows the SERVER's file system (its roots), not the viewer's OS.
  const windowsServer = [...roots, path ?? '', ...entries.map((e) => e.path)].some((p) => /^[A-Za-z]:([\\/]|$)/.test(p));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="lg"
      title="Choose a folder"
      data-testid="directory-browser"
    >
      <DialogBody className="gap-3">
        {description ? <p className="text-small text-fg-3">{description}</p> : null}
        <div className="flex gap-2">
          <Input
            mono
            className="flex-1"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                goto(typed.trim());
              }
            }}
            placeholder={windowsServer ? 'Paste a path, e.g. C:\\src\\my-app' : 'Paste a path, e.g. /path/to/my-app'}
            aria-label="Folder path"
          />
          <Button onClick={() => goto(typed.trim())} disabled={!typed.trim()} aria-label="Open this path">
            Open
          </Button>
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          <IconButton size="sm" icon="home" label="Go to drives and home" onClick={() => goto('')} />
          <IconButton
            size="sm"
            icon="chevron-up"
            label="Go to parent folder"
            onClick={() => goto(data?.parent ?? '')}
            disabled={!data?.parent}
          />
          <span className="min-w-0 flex-1 truncate font-mono text-small text-fg-2" title={data?.path || 'Drives and home'}>
            {data?.path || 'Drives and home'}
          </span>
          {data?.isGit ? (
            <Badge tone="run" icon="branch">
              git
            </Badge>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-card border border-line-soft">
          {listing.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-small text-fg-3">
              <Spinner size={14} /> Reading folder…
            </div>
          ) : errorMessage ? (
            <p role="alert" className="p-4 font-mono text-small text-err">
              {errorMessage}
            </p>
          ) : (
            <ul className="flex flex-col">
              {roots.map((root) => (
                <li key={`root:${root}`} className="border-b border-line-soft last:border-b-0">
                  <FolderRow icon="device" onClick={() => goto(root)}>
                    <span className="truncate font-mono">{root}</span>
                  </FolderRow>
                </li>
              ))}
              {entries.map((entry) => (
                <li key={entry.path} className="border-b border-line-soft last:border-b-0">
                  <FolderRow
                    icon={entry.isGit ? 'branch' : 'folder-open'}
                    onClick={() => goto(entry.path)}
                    onDoubleClick={() => pick(entry.path)}
                  >
                    <span className="min-w-0 flex-1 truncate text-left">{entry.name}</span>
                    {entry.isGit ? <Badge tone="run">repo</Badge> : null}
                  </FolderRow>
                </li>
              ))}
              {entries.length === 0 && roots.length === 0 ? (
                <li className="p-4 text-center text-small text-fg-3">
                  No sub-folders here — “Use this folder” picks the one above.
                </li>
              ) : null}
            </ul>
          )}
        </div>
      </DialogBody>
      <DialogFooter hint="Directories only. Double-click a folder to pick it.">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          icon="folder-open"
          onClick={() => pick((typed.trim() || data?.path || '').trim())}
          disabled={!typed.trim() && !data?.path}
        >
          Use this folder
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function FolderRow({
  icon,
  onClick,
  onDoubleClick,
  children,
}: {
  icon: IconConcept;
  onClick: () => void;
  onDoubleClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      fullWidth
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className="justify-start rounded-none text-fg"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <Icon concept={icon} size={14} className="shrink-0 text-fg-3" />
        {children}
      </span>
    </Button>
  );
}
