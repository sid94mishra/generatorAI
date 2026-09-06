// ────────────────────────────────────────────────────────────────
// DirectoryBrowser — pick a folder on the host, without typing a path
// ────────────────────────────────────────────────────────────────
//
// Backed by `GET /api/fs/dirs`, which lists directories only (never file
// contents) and is gated to local / administrative sessions server-side.
// A pasted path is still supported — it is often the fastest way in — but
// the browser is what makes the local-folder source discoverable at all.

import { useCallback, useEffect, useState } from 'react';
import { ArrowUp, CornerDownLeft, FolderGit2, FolderOpen, HardDrive, Home } from 'lucide-react';
import { Button, Input, Modal, Spinner } from '@/components/ui/index.js';
import { useFsDirs } from '@/hooks/sourceQueries.js';
import { cn } from '@/lib/utils.js';

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
    <Modal
      open={open}
      onClose={onClose}
      title="Choose a folder"
      description="The agent will work in the folder you pick. Directories only."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={commit}
            disabled={!typed.trim() && !data?.path}
            leftIcon={<FolderOpen className="h-4 w-4" />}
          >
            Use this folder
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        {/* Pasted path — the power-user route, and the only one that works
            for a folder the listing refuses to walk (permissions, a network
            share that is slow to enumerate). */}
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
            className="font-mono text-xs"
          />
          <Button
            variant="secondary"
            onClick={() => goto(typed.trim())}
            disabled={!typed.trim()}
            aria-label="Open this path"
            leftIcon={<CornerDownLeft className="h-3.5 w-3.5" />}
          >
            Open
          </Button>
        </div>

        {/* Breadcrumb / up */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => goto('')}
            title="Roots"
            aria-label="Go to drives and home"
            className="h-6 w-6"
          >
            <Home className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => goto(data?.parent ?? '')}
            disabled={!data?.parent}
            title="Parent folder"
            aria-label="Go to parent folder"
            className="h-6 w-6"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <span className="min-w-0 flex-1 truncate font-mono" title={data?.path || 'Drives and home'}>
            {data?.path || 'Drives and home'}
          </span>
          {data?.isGit && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              <FolderGit2 className="h-3 w-3" /> git
            </span>
          )}
        </div>

        {/* Listing */}
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
          {listing.isLoading ? (
            <div className="flex h-full items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
              <Spinner size="sm" /> Reading folder…
            </div>
          ) : errorMessage ? (
            <div className="p-4 text-xs text-danger">{errorMessage}</div>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {(data?.roots ?? []).map((root) => (
                <li key={`root:${root}`}>
                  <RowButton onClick={() => goto(root)} icon={<HardDrive className="h-3.5 w-3.5 text-muted-foreground" />}>
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
                    icon={
                      entry.isGit ? (
                        <FolderGit2 className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                      )
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    {entry.isGit && (
                      <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        repo
                      </span>
                    )}
                  </RowButton>
                </li>
              ))}
              {(data?.entries?.length ?? 0) === 0 && (data?.roots?.length ?? 0) === 0 && (
                <li className="p-4 text-center text-xs text-muted-foreground">
                  No sub-folders here — &ldquo;Use this folder&rdquo; picks the one above.
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </Modal>
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
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      {...(onDoubleClick ? { onDoubleClick } : {})}
      className={cn(
        'h-auto w-full justify-start gap-2 rounded-none px-3 py-1.5 text-left text-xs font-normal',
        'hover:bg-accent focus-visible:bg-accent',
      )}
    >
      {icon}
      {children}
    </Button>
  );
}
