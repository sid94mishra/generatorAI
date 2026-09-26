// ────────────────────────────────────────────────────────────────
// FindBar — find-in-page for the desktop shell (F-chat-05; restyled on the
// kit's S-12 FindBarFrame in P4-12, behaviour unchanged).
//
// Desktop only, and deliberately so: in a browser tab Cmd+F is the browser's
// own find and intercepting it would replace something better with something
// worse. In the Electron shell there is no browser chrome, so without this the
// standard shortcut did nothing.
//
// Chromium does the searching through `webContents.findInPage`. That matters:
// it matches text this app renders where the DOM cannot be walked for it —
// the canvas-rendered terminal — and it draws the highlights itself.
// Rendered inside the MainCard (ShellRoute), which anchors the frame.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { isDesktop, onDesktopCommand } from '@/lib/desktop.js';
import { FindBarFrame } from '@/ui/shell/FindBarFrame/FindBarFrame.js';

interface Bridge {
  findInPage?: (text: string, opts?: { forward?: boolean; findNext?: boolean }) => Promise<void>;
  stopFindInPage?: () => Promise<void>;
  onFoundInPage?: (cb: (r: { activeMatchOrdinal: number; matches: number }) => void) => () => void;
}

function bridge(): Bridge | undefined {
  return (window as unknown as { generatoraiDesktop?: Bridge }).generatoraiDesktop;
}

export function FindBar() {
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
      if (command === 'find.open') {
        setOpen(true);
        // Already open with a query → treat it as "find again", the way a
        // second Cmd+F behaves elsewhere.
        window.setTimeout(() => inputRef.current?.select(), 0);
        return;
      }
      if (command === 'find.next' || command === 'find.previous') {
        setQuery((current) => {
          if (!current) {
            setOpen(true);
            return current;
          }
          search(current, command === 'find.next', true);
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

  // The shell has no browser chrome, so nothing else would close this (the
  // widget's own Escape covers focus inside it; this covers focus elsewhere).
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

  return (
    <FindBarFrame
      inputRef={inputRef}
      query={query}
      onQueryChange={(next) => {
        setQuery(next);
        searchStarted.current = false;
        search(next, true, false);
      }}
      {...(result && query ? { matches: { current: result.activeMatchOrdinal, total: result.matches } } : {})}
      onPrev={() => search(query, false, true)}
      onNext={() => search(query, true, true)}
      onClose={close}
    />
  );
}
