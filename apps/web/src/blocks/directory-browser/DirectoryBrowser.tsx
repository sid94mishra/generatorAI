// ────────────────────────────────────────────────────────────────
// DirectoryBrowser — pick a folder on the SERVER host without typing a path
// (P5-03; the chat SourcePicker and the Projects forms share it, so it is a
// block) on the kit Dialog.
//
// The fallback of `useFolderPicker` (D-136): the desktop app on its own
// server opens the OS folder dialog instead. This one is for a plain browser
// (no absolute paths) and for the desktop app showing a remote server (the OS
// dialog would browse the wrong machine).
//
// Few clicks: it opens at the server user's home with shortcuts beside the
// list (Desktop, Documents, Projects… whichever exist, then the drives).
// Clicking a folder opens it; its "Use" button picks it without opening;
// "Use this folder" picks the folder on screen. A pasted path still works.
//
// Backed by `GET /api/fs/dirs`, which lists directories only (never file
// contents) and is gated to local / administrative sessions server-side.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { useFsDirs } from '@/hooks/sourceQueries.js';
import type { IconConcept } from '@/ui/icons/index.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Dialog, DialogBody, DialogFooter } from '@/ui/primitives/Dialog/Dialog.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { cn } from '@/ui/lib/cn.js';

export interface DirectoryBrowserProps {
  open: boolean;
  onClose: () => void;
  /** Fires with an absolute path when the user commits to a folder. */
  onPick: (path: string) => void;
  /** Where to open. Defaults to the server user's home. */
  initialPath?: string | undefined;
  /** One sentence under the title. */
  description?: string | undefined;
}

const PLACE_ICON: Record<string, IconConcept> = {
  desktop: 'computer',
  documents: 'file-text',
  downloads: 'download',
};

/** The last segment of a server path, on either separator. */
function baseName(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || p;
}

/** A dialog that walks the server's directories and returns the chosen absolute path. */
export function DirectoryBrowser({ open, onClose, onPick, initialPath, description }: DirectoryBrowserProps) {
  /** The folder on screen; `null` = not chosen yet (home, once the root listing names it). */
  const [path, setPath] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  // The root listing: home, its common folders and the drives (cached; cheap).
  const root = useFsDirs(open ? '' : null);
  const home = root.data?.home ?? root.data?.roots?.[0] ?? '';

  useEffect(() => {
    if (!open) return;
    setPath(initialPath ?? null);
    setTyped(initialPath ?? '');
  }, [open, initialPath]);

  const current = path ?? (root.data ? home : null);
  const listing = useFsDirs(open && current ? current : null);
  const data = listing.data;

  useEffect(() => {
    if (path === null && current) setTyped(current);
  }, [path, current]);

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

  const error = listing.error ?? root.error;
  const errorMessage = error instanceof Error ? error.message : error ? String(error) : null;
  const entries = data?.entries ?? [];
  const places = root.data?.places ?? [];
  const drives = (root.data?.roots ?? []).filter((r) => r !== home);
  // The example follows the SERVER's file system, not the viewer's OS.
  const windowsServer = /^[A-Za-z]:([\\/]|$)/.test(home);
  const loading = listing.isLoading || (current === null && root.isLoading);
  const shown = data?.path ?? current ?? '';

  const shortcut = (target: string, label: string, icon: IconConcept, mono = false) => (
    <Button
      key={target}
      variant="ghost"
      size="sm"
      fullWidth
      icon={icon}
      pressed={shown === target}
      onClick={() => goto(target)}
      className={cn('justify-start', mono && 'font-mono')}
      title={target}
    >
      <span className="min-w-0 truncate">{label}</span>
    </Button>
  );

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
                if (typed.trim()) goto(typed.trim());
              }
            }}
            placeholder={windowsServer ? 'Paste a path, e.g. C:\\src\\my-app' : 'Paste a path, e.g. /path/to/my-app'}
            aria-label="Folder path"
          />
          <Button onClick={() => goto(typed.trim())} disabled={!typed.trim()} aria-label="Open this path">
            Open
          </Button>
        </div>

        <div className="flex min-h-0 gap-3">
          <nav aria-label="Places" className="flex max-h-96 w-40 shrink-0 flex-col gap-0.5 overflow-auto">
            {home ? shortcut(home, 'Home', 'home') : null}
            {places.map((p) => shortcut(p.path, p.name, PLACE_ICON[p.name.toLowerCase()] ?? 'folder-open'))}
            {drives.length > 0 ? <div className="my-1 border-t border-line" /> : null}
            {drives.map((d) => shortcut(d, d, 'device', true))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <IconButton
                size="sm"
                icon="chevron-up"
                label="Go to parent folder"
                onClick={() => data?.parent && goto(data.parent)}
                disabled={!data?.parent}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-small text-fg-2" title={shown}>
                {shown}
              </span>
              {data?.isGit ? (
                <Badge tone="run" icon="branch">
                  git
                </Badge>
              ) : null}
            </div>

            <div className="max-h-96 min-h-72 overflow-auto rounded-card border border-line">
              {loading ? (
                <div className="flex items-center justify-center gap-2 p-6 text-small text-fg-3">
                  <Spinner size={14} /> Reading folder…
                </div>
              ) : errorMessage ? (
                <p role="alert" className="p-4 font-mono text-small text-err">
                  {errorMessage}
                </p>
              ) : entries.length === 0 ? (
                <p className="p-4 text-center text-small text-fg-3">No sub-folders here. “Use this folder” picks this one.</p>
              ) : (
                <ul className="flex flex-col" aria-label={`Folders in ${baseName(shown)}`}>
                  {entries.map((entry) => (
                    <li key={entry.path} className="group flex items-center border-b border-line last:border-b-0">
                      <Button
                        variant="ghost"
                        onClick={() => goto(entry.path)}
                        className="min-w-0 flex-1 justify-start rounded-none text-fg"
                        aria-label={`Open ${entry.name}`}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <Icon concept={entry.isGit ? 'branch' : 'folder-open'} size={14} className="shrink-0 text-fg-3" />
                          <span className="min-w-0 truncate text-left">{entry.name}</span>
                          {entry.isGit ? <Badge tone="run" size="sm">repo</Badge> : null}
                        </span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => pick(entry.path)}
                        className="mr-1 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={`Use ${entry.name}`}
                      >
                        Use
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </DialogBody>
      <DialogFooter hint="Folders on the server's computer.">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          icon="folder-open"
          onClick={() => pick(typed.trim() || data?.path || '')}
          disabled={!data?.path && !typed.trim()}
        >
          Use this folder
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
