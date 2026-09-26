// ────────────────────────────────────────────────────────────────
// B-04 DirectoryBrowser — pick a folder on the host, without typing a path.
// ────────────────────────────────────────────────────────────────
//
// Backed by `GET /api/fs/dirs`, which lists directories only (never file
// contents) and is gated to local / administrative sessions server-side.
// A pasted path is still supported — it is often the fastest way in — but
// the browser is what makes the local-folder source discoverable at all.
//
// Kit rebuild of `components/chat/sources/DirectoryBrowser.tsx` (P5-09):
// same props/behaviour, Dialog `lg` instead of the legacy `Modal`. Used by
// `SourcePicker` (create flows, "Edit sources…") and, unchanged, by
// CreateProjectPage / ProjectDetailPage (Projects feature).
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import { Button } from '../../ui/primitives/Button/Button.js';
import { Dialog, DialogBody, DialogFooter } from '../../ui/primitives/Dialog/Dialog.js';
import { Icon } from '../../ui/icons/Icon.js';
import { IconButton } from '../../ui/primitives/IconButton/IconButton.js';
import { Input } from '../../ui/primitives/Input/Input.js';
import { Spinner } from '../../ui/primitives/Spinner/Spinner.js';
import { useFsDirs } from '../../hooks/sourceQueries.js';

export interface DirectoryBrowserProps {
  open: boolean;
  onClose: () => void;
  /** Fires with an absolute path when the user commits to a folder. */
  onPick: (path: string) => void;
  /** Where to open. Defaults to the roots listing. */
  initialPath?: string;
}

export function DirectoryBrowser({ open, onClose, onPick, initialPath }: DirectoryBrowserProps) {
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

  const commit = useCallback(() => {
    const chosen = (typed.trim() || data?.path || '').trim();
    if (!chosen) return;
    onPick(chosen);
    onClose();
  }, [typed, data?.path, onPick, onClose]);

  const errorMessage =
    listing.error instanceof Error ? listing.error.message : listing.error ? String(listing.error) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="lg"
      title="Choose a folder"
    >
      <DialogBody className="flex min-h-0 flex-1 flex-col gap-2">
        <p className="text-small text-fg-3">The agent will work in the folder you pick. Directories only.</p>
        {/* Pasted path — the power-user route, and the only one that works for
            a folder the listing refuses to walk (permissions, a slow share). */}
        <div className="flex gap-2">
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                goto(typed.trim());
              }
            }}
            placeholder="Paste a path, e.g. C:\src\my-app"
            aria-label="Folder path"
            mono
            className="flex-1"
          />
          <Button variant="secondary" onClick={() => goto(typed.trim())} disabled={!typed.trim()} icon="check">
            Open
          </Button>
        </div>

        {/* Breadcrumb / up */}
        <div className="flex items-center gap-1.5 text-small text-fg-3">
          <IconButton icon="home" label="Go to drives and home" size="sm" onClick={() => goto('')} />
          <IconButton
            icon="chevron-up"
            label="Go to parent folder"
            size="sm"
            onClick={() => goto(data?.parent ?? '')}
            disabled={!data?.parent}
          />
          <span className="min-w-0 flex-1 truncate font-mono" title={data?.path || 'Drives and home'}>
            {data?.path || 'Drives and home'}
          </span>
          {data?.isGit ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-control bg-selected px-1.5 py-0.5 text-micro font-medium text-fg">
              <Icon concept="branch" size={12} /> git
            </span>
          ) : null}
        </div>

        {/* Listing */}
        <div className="min-h-0 flex-1 overflow-auto rounded-control border border-line-soft">
          {listing.isLoading ? (
            <div className="flex h-full items-center justify-center gap-2 p-6 text-small text-fg-3">
              <Spinner size={14} /> Reading folder…
            </div>
          ) : errorMessage ? (
            <div className="p-4 text-small text-err">{errorMessage}</div>
          ) : (
            <ul className="divide-y divide-line-soft" role="list">
              {(data?.roots ?? []).map((root) => (
                <li key={`root:${root}`}>
                  <RowButton onClick={() => goto(root)} icon="folder-open">
                    <span className="font-mono">{root}</span>
                  </RowButton>
                </li>
              ))}
              {(data?.entries ?? []).map((entry) => (
                <li key={entry.path}>
                  <RowButton
                    onClick={() => goto(entry.path)}
                    onDoubleClick={() => {
                      onPick(entry.path);
                      onClose();
                    }}
                    icon="folder-open"
                  >
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    {entry.isGit ? (
                      <span className="shrink-0 rounded-control bg-selected px-1.5 py-0.5 text-micro font-medium text-fg">
                        repo
                      </span>
                    ) : null}
                  </RowButton>
                </li>
              ))}
              {(data?.entries?.length ?? 0) === 0 && (data?.roots?.length ?? 0) === 0 ? (
                <li className="p-4 text-center text-small text-fg-3">
                  No sub-folders here — “Use this folder” picks the one above.
                </li>
              ) : null}
            </ul>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={commit} disabled={!typed.trim() && !data?.path} icon="folder-open">
          Use this folder
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function RowButton({
  onClick,
  onDoubleClick,
  icon,
  children,
}: {
  onClick: () => void;
  onDoubleClick?: () => void;
  icon: IconConcept;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      icon={icon}
      onClick={onClick}
      {...(onDoubleClick ? { onDoubleClick } : {})}
      fullWidth
      className="h-auto justify-start rounded-none px-3 py-1.5 text-left font-normal"
    >
      {children}
    </Button>
  );
}
