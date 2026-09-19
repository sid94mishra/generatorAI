// ────────────────────────────────────────────────────────────────
// FindBar — find-in-page for the desktop shell.
//
// Desktop only, and deliberately so: in a browser tab Cmd+F is the browser's
// own find and intercepting it would replace something better with something
// worse. In the Electron shell there is no browser chrome, so without this the
// standard shortcut did nothing — `Edit ▸ Find` opened the command palette
// (which has its own shortcut) and `Find Next` dispatched an event no one
// listened for.
//
// Chromium does the searching through `webContents.findInPage`. That matters:
// it matches text this app renders where the DOM cannot be walked for it —
// virtualised lists, the canvas-rendered terminal — and it draws the
// highlights itself.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { Button } from '@/components/ui/index.js';
import { isDesktop, onDesktopCommand } from '@/lib/desktop.js';

interface Bridge {
  findInPage?: (text: string, opts?: { forward?: boolean; findNext?: boolean }) => Promise<void>;
  stopFindInPage?: () => Promise<void>;
  onFoundInPage?: (cb: (r: { activeMatchOrdinal: number; matches: number }) => void) => () => void;
}

function bridge(): Bridge | undefined {
  return (window as unknown as { generatoraiDesktop?: Bridge }).generatoraiDesktop;
}

export function FindBar(): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ activeMatchOrdinal: number; matches: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Chromium treats the FIRST call for a query as "start a search" and every
  // later one as "step to the next match"; getting this wrong makes the first
  // Enter jump two matches forward.
  const searchStarted = useRef(false);

  const search = useCallback((text: string, forward: boolean, step: boolean) => {
    const api = bridge();
    if (!api?.findInPage) return;
    if (!text) {
      void api.stopFindInPage?.();
      setResult(null);
      searchStarted.current = false;
      return;
    }
    // A new query has to end the previous session first. Chromium keeps one
    // find session per page and will not re-report a request it considers a
    // continuation, which left the bar with no match count at all.
    if (!step || !searchStarted.current) {
      void api.stopFindInPage?.();
      searchStarted.current = false;
    }
    void api.findInPage(text, { forward, findNext: step && searchStarted.current });
    searchStarted.current = true;
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setResult(null);
    searchStarted.current = false;
    void bridge()?.stopFindInPage?.();
  }, []);

  // Menu commands: open the bar, or step through the current query.
  useEffect(() => {
    if (!isDesktop) return undefined;
    return onDesktopCommand((command) => {
      if (command === 'find-in-page') {
        setOpen(true);
        // Already open with a query → treat it as "find again", the way a
        // second Cmd+F behaves elsewhere.
        window.setTimeout(() => inputRef.current?.select(), 0);
        return;
      }
      if (command === 'find-next' || command === 'find-previous') {
        setQuery((current) => {
          if (!current) {
            setOpen(true);
            return current;
          }
          search(current, command === 'find-next', true);
          return current;
        });
      }
    });
  }, [search]);

  useEffect(() => {
    const api = bridge();
    if (!api?.onFoundInPage) return undefined;
    return api.onFoundInPage(setResult);
  }, []);

  // The shell has no browser chrome, so nothing else would close this.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!isDesktop || !open) return null;

  const count = result && query
    ? result.matches === 0
      ? 'No results'
      : `${result.activeMatchOrdinal} of ${result.matches}`
    : '';

  return (
    <div
      role="search"
      data-testid="find-bar"
      className="absolute right-4 top-2 z-50 flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 shadow-lg"
    >
      <input
        ref={inputRef}
        value={query}
        aria-label="Find in page"
        placeholder="Find in page"
        className="h-7 w-52 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          searchStarted.current = false;
          search(next, true, false);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          search(query, !e.shiftKey, true);
        }}
      />
      <span className="min-w-16 select-none text-right text-xs tabular-nums text-muted-foreground">
        {count}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous match"
        disabled={!result?.matches}
        onClick={() => search(query, false, true)}
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next match"
        disabled={!result?.matches}
        onClick={() => search(query, true, true)}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Close find bar" onClick={close}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
