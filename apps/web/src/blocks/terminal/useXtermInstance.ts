// ────────────────────────────────────────────────────────────────
// useXtermInstance — the xterm 6 host, no session logic (B-10, 03 §6.7).
//
// Mounts one xterm per container for the component's lifetime: fit, search,
// web-links and (best effort) WebGL addons; refits on container resize;
// re-themes from the design tokens (`resolveTerminalPalette`) when the theme
// or mode changes without recreating the terminal; intercepts Ctrl/Cmd+F so
// the find widget opens instead of the shell receiving ^F.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal as Xterm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { BUNDLED_FONT_FAMILIES, resolveTerminalPalette } from '@generatorai/design-tokens';
import { useTheme } from '@/providers/ThemeProvider.js';

/** The bundled mono family (D-16, `styles/fonts.css`). */
const TERMINAL_FONT = BUNDLED_FONT_FAMILIES[1];

/**
 * Bundled JetBrains Mono first so every OS renders the same face; Nerd Font
 * families trail so prompt themes (Powerlevel10k, Starship, Oh My Posh) find
 * their Private Use Area glyphs — Chromium falls back per glyph only to fonts
 * named here. Consolas covers Windows before the generic fallback.
 */
const FONT_STACK =
  `"${TERMINAL_FONT}", "JetBrains Mono", "Fira Code", Menlo, Consolas, "MesloLGS NF", "Symbols Nerd Font Mono", ` +
  '"JetBrainsMono Nerd Font", "FiraCode Nerd Font", "Hack Nerd Font", "CaskaydiaCove Nerd Font", monospace';

/** Resolves once the bundled mono face is usable (or the browser lacks the Font Loading API). */
function loadTerminalFont(): Promise<unknown> {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts;
  return fonts ? fonts.load(`12px "${TERMINAL_FONT}"`) : Promise.resolve();
}

export interface XtermFindState {
  open: boolean;
  query: string;
  /** Undefined until a search ran; `total: 0` means no match. */
  matches?: { current: number; total: number };
}

export interface XtermInstance {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The live terminal (null before mount / after unmount). */
  termRef: React.RefObject<Xterm | null>;
  hasSelection: boolean;
  find: XtermFindState;
  openFind: () => void;
  closeFind: () => void;
  setFindQuery: (query: string) => void;
  findNext: () => void;
  findPrev: () => void;
  clear: () => void;
}

/** Drops the match count (nothing searched). */
const withoutMatches = ({ open, query }: XtermFindState): XtermFindState => ({ open, query });

export function useXtermInstance(): XtermInstance {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Xterm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [find, setFind] = useState<XtermFindState>({ open: false, query: '' });

  // xterm paints to a canvas and cannot resolve `var(--…)`: it needs literals,
  // which come from the token package (not getComputedStyle, which would race
  // the theme swap).
  const { resolvedTheme, theme } = useTheme();
  const palette = useMemo(() => resolveTerminalPalette(theme, resolvedTheme), [theme, resolvedTheme]);
  // Read by the mount effect without re-running it (that would drop the PTY).
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    const term = new Xterm({
      cursorBlink: true,
      scrollback: 5000,
      fontFamily: FONT_STACK,
      fontSize: 12,
      lineHeight: 1.2,
      allowProposedApi: true,
      theme: paletteRef.current,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon());
    // xterm measures its cell grid (and the WebGL renderer sizes its glyph
    // atlas) once, at open. Opening before the bundled face has loaded, or into
    // a zero-size box (a collapsed dock), keeps a wrong grid for good — so open
    // only once both hold. Writes made before open are buffered by xterm.
    let fontReady = false;
    let opened = false;
    const tryOpen = () => {
      if (disposed || opened || !fontReady) return;
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      opened = true;
      term.open(container);
      try {
        // WebGL can fail on some GPUs / under CSP — the DOM renderer remains.
        term.loadAddon(new WebglAddon());
      } catch { /* DOM renderer */ }
      try { fit.fit(); } catch { /* not laid out yet */ }
    };
    const onFont = () => {
      fontReady = true;
      tryOpen();
    };
    loadTerminalFont().then(onFont, onFont);
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    const selectionSub = term.onSelectionChange(() => setHasSelection(term.hasSelection()));
    const resultsSub = search.onDidChangeResults(({ resultIndex, resultCount }) => {
      setFind((prev) => ({ ...prev, matches: { current: resultIndex + 1, total: resultCount } }));
    });
    // Ctrl/Cmd+F opens the find widget instead of reaching the shell as ^F.
    term.attachCustomKeyEventHandler((ev) => {
      const isFind = (ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === 'f';
      if (isFind && ev.type === 'keydown') {
        setFind((prev) => ({ ...prev, open: true }));
        return false;
      }
      return true;
    });
    // Layout may not be settled on the first frame.
    const fitTimer = setTimeout(() => { if (opened) { try { fit.fit(); } catch { /* ignore */ } } }, 50);
    const ro = new ResizeObserver(() => {
      if (!opened) {
        tryOpen();
        return;
      }
      try { fit.fit(); } catch { /* ignore */ }
    });
    ro.observe(container);

    return () => {
      disposed = true;
      clearTimeout(fitTimer);
      ro.disconnect();
      try { selectionSub.dispose(); } catch { /* ignore */ }
      try { resultsSub.dispose(); } catch { /* ignore */ }
      try { term.attachCustomKeyEventHandler(() => true); } catch { /* ignore */ }
      try { term.dispose(); } catch { /* ignore */ }
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
  }, []);

  // Re-theme in place: assigning `options.theme` repaints buffer and cursor.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    try { term.options.theme = palette; } catch { /* ignore */ }
  }, [palette]);

  const searchOptions = useMemo<ISearchOptions>(
    () => ({
      caseSensitive: false,
      // Decorations need opaque #RRGGBB (the selection colour carries alpha):
      // a muted fill for every match, the warn hue outlines the active one.
      decorations: {
        matchBackground: palette.brightBlack,
        matchOverviewRuler: palette.yellow,
        activeMatchBackground: palette.brightBlack,
        activeMatchBorder: palette.yellow,
        activeMatchColorOverviewRuler: palette.yellow,
      },
    }),
    [palette],
  );

  const runSearch = useCallback(
    (query: string, direction: 'next' | 'prev') => {
      const s = searchRef.current;
      if (!s) return;
      if (!query) {
        // An empty query clears the decorations instead of matching everything.
        try { s.clearDecorations(); } catch { /* ignore */ }
        setFind(withoutMatches);
        return;
      }
      let found = false;
      try {
        found = direction === 'next' ? s.findNext(query, searchOptions) : s.findPrevious(query, searchOptions);
      } catch { /* ignore */ }
      if (!found) setFind((prev) => ({ ...prev, matches: { current: 0, total: 0 } }));
    },
    [searchOptions],
  );

  const openFind = useCallback(() => setFind((prev) => ({ ...prev, open: true })), []);
  const closeFind = useCallback(() => {
    setFind({ open: false, query: '' });
    try { searchRef.current?.clearDecorations(); } catch { /* ignore */ }
    termRef.current?.focus();
  }, []);
  const setFindQuery = useCallback(
    (query: string) => {
      setFind((prev) => ({ ...prev, query }));
      runSearch(query, 'next');
    },
    [runSearch],
  );
  const findNext = useCallback(() => runSearch(find.query, 'next'), [runSearch, find.query]);
  const findPrev = useCallback(() => runSearch(find.query, 'prev'), [runSearch, find.query]);

  const clear = useCallback(() => {
    termRef.current?.clear();
    try { searchRef.current?.clearDecorations(); } catch { /* ignore */ }
    setFind(withoutMatches);
  }, []);

  return { containerRef, termRef, hasSelection, find, openFind, closeFind, setFindQuery, findNext, findPrev, clear };
}
