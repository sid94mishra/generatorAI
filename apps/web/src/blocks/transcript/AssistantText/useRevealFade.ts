// ────────────────────────────────────────────────────────────────
// useRevealFade — the newest streamed words fade in (D-91).
//
// Drawn with the CSS Custom Highlight API: three highlights (`gai-reveal-1…3`,
// globals.css) colour the text revealed in the last ~60 / 120 / 180 ms at
// 25 / 55 / 80 % of the ink, so a word settles in over ~180 ms. No element is
// added, moved or re-rendered — colour only, so there is no layout shift and
// the markdown tree is untouched. Off with reduced motion, where the API is
// missing, and the moment the turn ends.
// ────────────────────────────────────────────────────────────────

import { useEffect, type RefObject } from 'react';
import { prefersReducedMotion } from '@/ui/lib/motion.js';

const NAMES = ['gai-reveal-1', 'gai-reveal-2', 'gai-reveal-3'] as const;
/** Upper age, in ms, of the text each highlight covers (newest first). */
const AGES = [60, 120, 180] as const;

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

export function useRevealFade(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active || !api()) return undefined;
    if (prefersReducedMotion()) return undefined;
    if (document.documentElement.dataset['motion'] === 'reduce') return undefined;
    const id = Symbol('reveal');
    const history: Array<{ len: number; t: number }> = [];
    let frame = 0;
    const tick = (now: number) => {
      const el = ref.current;
      if (el) {
        const len = el.textContent?.length ?? 0;
        if (history.length === 0 || history[history.length - 1]!.len !== len) history.push({ len, t: now });
        while (history.length > 2 && now - history[1]!.t > AGES[AGES.length - 1]!) history.shift();
        const lenAt = (age: number) => {
          for (let i = history.length - 1; i >= 0; i -= 1) if (now - history[i]!.t >= age) return history[i]!.len;
          return history[0]!.len;
        };
        // [len … lenAt(60)) newest, then [lenAt(60) … lenAt(120)), [lenAt(120) … lenAt(180)).
        const cuts = [len, ...AGES.map(lenAt)];
        panels.set(id, rangesFor(el, len, cuts));
        publish();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      panels.delete(id);
      publish();
    };
  }, [ref, active]);
}
