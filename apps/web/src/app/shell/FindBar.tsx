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
  // Chromium moves focus to the active match when it searches, so after the first character the bar lost the
  // caret and the rest of the query went to the page ("WP0" left "W" in the field). Remember where the caret
  // was and put it back on each result (the focus moves ~0.3 s after the call, just before `found-in-page`);
  // the restore ends 1.5 s after the search.
  const restoreFocus = useRef<{ start: number | null; end: number | null } | null>(null);
  const restoreTimer = useRef<number | undefined>(undefined);
  const typingTimer = useRef<number | undefined>(undefined);

  // Every found event re-asserts it (Chromium reports several and may move focus after the first); the timer's
  // call is the last one and ends the restore.
  const refocusInput = useCallback((final: boolean) => {
    const pending = restoreFocus.current;
    if (final) {
      restoreFocus.current = null;
      window.clearTimeout(restoreTimer.current);
    }
    const el = inputRef.current;
    if (!pending || !el || document.activeElement === el) return;
    el.focus({ preventScroll: true });
    if (pending.start != null && pending.end != null) el.setSelectionRange(pending.start, pending.end);
  }, []);

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
    // Chromium starts a follow-up search from the selection: with the caret in the field every step restarted
    // at match 1 (the Next button too). A step takes focus and the selection off the bar first (keys still reach the bar — onKey).
    const focused = document.activeElement;
    if (step && focused instanceof HTMLElement && focused.closest('[data-testid="find-bar"]')) {
      focused.blur();
      window.getSelection()?.removeAllRanges();
    }
    // Only a new query restores the caret: focusing the input after a step resets Chromium's find start point,
    // so every Enter landed on match 1 again. After a step the window handler below routes keys to the bar.
    const el = inputRef.current;
    if (!step && el && document.activeElement === el) {
      restoreFocus.current = { start: el.selectionStart, end: el.selectionEnd };
      window.clearTimeout(restoreTimer.current);
      restoreTimer.current = window.setTimeout(() => refocusInput(true), 1500);
    }
    void api.findInPage(text, { forward, findNext: step && searchStarted.current });
    searchStarted.current = true;
  }, [refocusInput]);

  const close = useCallback(() => {
    window.clearTimeout(typingTimer.current);
    restoreFocus.current = null;
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
    return api.onFoundInPage((r) => {
      setResult(r);
      refocusInput(false);
    });
  }, [refocusInput]);

  // The shell has no browser chrome, so nothing else would close this (the
  // widget's own Escape covers focus inside it; this covers focus elsewhere).
  // While the bar is open and the search took focus to the page: Enter / Shift+Enter step, and a typed
  // character goes back into the field (focus moved in keydown receives the character).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      const el = inputRef.current;
      // An Enter typed in the field was already handled by the field (which then moved focus to the page).
      if (!el || e.target === el || document.activeElement !== document.body) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        search(el.value, !e.shiftKey, true);
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        el.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, search]);

  // Opening selects the previous query, so typing replaces it (a second Cmd+F does the same while open).
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  if (!isDesktop || !open) return null;

  return (
    <FindBarFrame
      inputRef={inputRef}
      query={query}
      onQueryChange={(next) => {
        setQuery(next);
        searchStarted.current = false;
        // One search per pause in typing, not per keystroke: each search moves Chromium's focus.
        window.clearTimeout(typingTimer.current);
        typingTimer.current = window.setTimeout(() => search(next, true, false), 120);
      }}
      {...(result && query ? { matches: { current: result.activeMatchOrdinal, total: result.matches } } : {})}
      onPrev={() => search(query, false, true)}
      onNext={() => search(query, true, true)}
      onClose={close}
    />
  );
}
