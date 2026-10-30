// ────────────────────────────────────────────────────────────────
// useRevealFade — the newest streamed words fade in (D-91, D-152, D-160).
//
// Drawn with the CSS Custom Highlight API: six highlights (`gai-reveal-1…6`,
// globals.css) colour the text revealed in the last 90 / 180 / … / 540 ms
// from faint ink up to full ink, so each word settles in over ~half a second
// — a soft shimmer riding the leading edge. Neutral ink only (D-160): the
// Running-tinted edge read as a coloured band flickering along the line.
// No element is added, moved or re-rendered — colour only, so there is no
// layout shift and the markdown tree is untouched. Off with reduced motion,
// where the API is missing, and ~540 ms after the reveal ends.
//
// The ranges are rebuilt every frame AND right after each commit (`version`):
// React rewriting a text node collapses every range inside it, so ranges built
// only per frame were empty whenever the page painted between a commit and the
// next frame — the fade then often did not show at all.
// ────────────────────────────────────────────────────────────────

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { prefersReducedMotion } from '@/ui/lib/motion.js';

const NAMES = ['gai-reveal-1', 'gai-reveal-2', 'gai-reveal-3', 'gai-reveal-4', 'gai-reveal-5', 'gai-reveal-6'] as const;
/** Upper age, in ms, of the text each highlight covers (newest first). */
const AGES = [90, 180, 270, 360, 450, 540] as const;

type Highlights = { set(name: string, value: unknown): void; delete(name: string): void };
type HighlightCtor = new (...ranges: Range[]) => unknown;

function api(): { highlights: Highlights; Highlight: HighlightCtor } | null {
  const css = (globalThis as { CSS?: { highlights?: Highlights } }).CSS;
  const Highlight = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  return css?.highlights && Highlight ? { highlights: css.highlights, Highlight } : null;
}

/** Every streaming panel's ranges, per highlight; the highlights are shared document-wide. */
const panels = new Map<symbol, Range[][]>();

function publish(): void {
  const a = api();
  if (!a) return;
  NAMES.forEach((name, bucket) => {
    const ranges = [...panels.values()].flatMap((r) => r[bucket] ?? []);
    if (ranges.length > 0) a.highlights.set(name, new a.Highlight(...ranges));
    else a.highlights.delete(name);
  });
}

/** Ranges for text offsets [from, to) of `root`, walking text nodes backward from the end. */
function rangesFor(root: Element, total: number, cuts: readonly number[]): Range[][] {
  const out: Range[][] = NAMES.map(() => []);
  const lowest = cuts[cuts.length - 1]!;
  if (lowest >= total) return out;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  let end = total;
  for (let i = nodes.length - 1; i >= 0 && end > lowest; i -= 1) {
    const node = nodes[i]!;
    const start = end - node.data.length;
    for (let b = 0; b < NAMES.length; b += 1) {
      const hi = cuts[b]!;
      const lo = cuts[b + 1]!;
      const from = Math.max(start, lo);
      const to = Math.min(end, hi);
      if (to > from) {
        const range = document.createRange();
        range.setStart(node, from - start);
        range.setEnd(node, to - start);
        out[b]!.push(range);
      }
    }
    end = start;
  }
  return out;
}

export function useRevealFade(ref: RefObject<HTMLElement | null>, active: boolean, version: unknown): void {
  // The last characters revealed still finish settling after the reveal ends.
  const [on, setOn] = useState(active);
  useEffect(() => {
    if (active) {
      setOn(true);
      return undefined;
    }
    const timer = setTimeout(() => setOn(false), AGES[AGES.length - 1]! + 40);
    return () => clearTimeout(timer);
  }, [active]);
  const update = useRef<((now: number) => void) | null>(null);
  useEffect(() => {
    if (!on || !api()) return undefined;
    if (prefersReducedMotion()) return undefined;
    if (document.documentElement.dataset['motion'] === 'reduce') return undefined;
    const id = Symbol('reveal');
    const history: Array<{ len: number; t: number }> = [];
    let frame = 0;
    const step = (now: number) => {
      const el = ref.current;
      if (el) {
        const len = el.textContent?.length ?? 0;
        if (history.length === 0 || history[history.length - 1]!.len !== len) history.push({ len, t: now });
        while (history.length > 2 && now - history[1]!.t > AGES[AGES.length - 1]!) history.shift();
        const lenAt = (age: number) => {
          for (let i = history.length - 1; i >= 0; i -= 1) if (now - history[i]!.t >= age) return history[i]!.len;
          return history[0]!.len;
        };
        // [len … lenAt(90)) newest, then [lenAt(90) … lenAt(180)), … [lenAt(450) … lenAt(540)).
        const cuts = [len, ...AGES.map(lenAt)];
        panels.set(id, rangesFor(el, len, cuts));
        publish();
      }
    };
    const tick = (now: number) => {
      step(now);
      frame = requestAnimationFrame(tick);
    };
    update.current = step;
    frame = requestAnimationFrame(tick);
    return () => {
      update.current = null;
      cancelAnimationFrame(frame);
      panels.delete(id);
      publish();
    };
  }, [ref, on]);
  // After React wrote new text (and collapsed the ranges in it), before the page paints.
  useLayoutEffect(() => {
    update.current?.(performance.now());
  }, [version]);
}
