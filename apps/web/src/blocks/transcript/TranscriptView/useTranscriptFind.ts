// ────────────────────────────────────────────────────────────────
// useTranscriptFind — app-level find over the WHOLE transcript model (D-33).
//
// Chromium's find (browser Cmd+F, desktop `findInPage`) only sees rendered
// DOM; a virtualized transcript does not render off-screen turns. This hook
// searches the turns' text (`turnSearchText`), scrolls the turn holding the
// current match into view, waits for it to render, then marks the matches in
// that turn with the CSS Custom Highlight API (`::highlight(gai-find)`), so no
// DOM is rewritten and React stays the owner of every node.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findInTexts, turnSearchText, type TranscriptTurn } from '@generatorai/client-core';

export interface TranscriptFindTarget {
  /** Bring turn `index` into view (virtualizer.scrollToIndex, or scrollIntoView). */
  scrollToTurn: (index: number) => void;
  /** The rendered element of turn `index`, or null while it is not rendered. */
  turnElement: (index: number) => HTMLElement | null;
  /** The scroll container (to centre the current match). */
  scrollElement: () => HTMLElement | null;
}

interface Match {
  turn: number;
  occurrence: number;
}

const HIGHLIGHT = 'gai-find';
const HIGHLIGHT_CURRENT = 'gai-find-current';

type HighlightRegistry = { set: (name: string, h: unknown) => void; delete: (name: string) => void };

function registry(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return css?.highlights ?? null;
}

function makeHighlight(ranges: Range[]): unknown {
  const H = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  return H ? new H(...ranges) : null;
}

function clearHighlights(): void {
  const reg = registry();
  reg?.delete(HIGHLIGHT);
  reg?.delete(HIGHLIGHT_CURRENT);
}

/** Every case-insensitive occurrence of `query` inside `root`'s text nodes. */
export function rangesIn(root: HTMLElement, query: string): Range[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const out: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue ?? '').toLowerCase();
    let at = text.indexOf(q);
    while (at !== -1) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + q.length);
      out.push(range);
      at = text.indexOf(q, at + q.length);
    }
  }
  return out;
}

export function useTranscriptFind(turns: readonly TranscriptTurn[], target: TranscriptFindTarget) {
  const [isOpen, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(0);
  const targetRef = useRef(target);
  targetRef.current = target;

  // Text is derived only while find is open: it walks every turn's blocks.
  const texts = useMemo(() => (isOpen ? turns.map(turnSearchText) : []), [isOpen, turns]);
  const matches = useMemo<Match[]>(() => {
    const out: Match[] = [];
    for (const hit of findInTexts(texts, query)) {
      for (let i = 0; i < hit.occurrences; i += 1) out.push({ turn: hit.turn, occurrence: i });
    }
    return out;
  }, [texts, query]);

  useEffect(() => setCurrent(0), [query]);

  // Reveal the current match: scroll its turn in, wait for it to render, mark it.
  useEffect(() => {
    if (!isOpen) return undefined;
    const match = matches[Math.min(current, matches.length - 1)];
    if (!match || !query.trim()) {
      clearHighlights();
      return undefined;
    }
    let cancelled = false;
    let frames = 0;
    targetRef.current.scrollToTurn(match.turn);
    const tick = () => {
      if (cancelled) return;
      const el = targetRef.current.turnElement(match.turn);
      if (!el) {
        frames += 1;
        if (frames < 60) requestAnimationFrame(tick);
        return;
      }
      const ranges = rangesIn(el, query.trim());
      const reg = registry();
      const active = ranges[Math.min(match.occurrence, ranges.length - 1)];
      if (reg) {
        const all = makeHighlight(ranges);
        if (all) reg.set(HIGHLIGHT, all);
        const cur = active ? makeHighlight([active]) : null;
        if (cur) reg.set(HIGHLIGHT_CURRENT, cur);
        else reg.delete(HIGHLIGHT_CURRENT);
      }
      const scroller = targetRef.current.scrollElement();
      const rect = (active ?? el).getBoundingClientRect();
      if (scroller) {
        const box = scroller.getBoundingClientRect();
        if (rect.top < box.top + 40 || rect.bottom > box.bottom - 40) {
          scroller.scrollTop += rect.top - box.top - box.height / 3;
        }
      }
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [isOpen, matches, current, query]);

  useEffect(() => (isOpen ? undefined : clearHighlights()), [isOpen]);
  useEffect(() => clearHighlights, []);

  const open = useCallback((initial?: string) => {
    setOpen(true);
    if (initial != null) setQuery(initial);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    clearHighlights();
  }, []);
  const next = useCallback(() => setCurrent((c) => (matches.length ? (c + 1) % matches.length : 0)), [matches.length]);
  const prev = useCallback(
    () => setCurrent((c) => (matches.length ? (c - 1 + matches.length) % matches.length : 0)),
    [matches.length],
  );

  return {
    isOpen,
    open,
    close,
    query,
    setQuery,
    next,
    prev,
    matches: query.trim() ? { current: matches.length ? Math.min(current, matches.length - 1) + 1 : 0, total: matches.length } : undefined,
  };
}
