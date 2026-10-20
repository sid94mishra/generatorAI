// ────────────────────────────────────────────────────────────────
// usePacedText — the streaming text a panel paints, revealed by the shared
// pacer (client-core `advancePacer`, D-91) one animation frame at a time.
//
// `text` is everything that has arrived and stays the source of truth (copy,
// find and the persisted message never wait for the reveal). The reveal shows
// all of it at once when the page is hidden, when `paced` is false (the reader
// scrolled away) and when `flushKey` changes (a view-mode switch); when the
// turn ends the rest catches up within 250 ms rather than in one frame.
// Reduced motion reveals whole bursts in steps.
//
// D-152: the rate is eased (`easeMs`), so a burst glides in and slows into
// its last words; useRevealFade softens the leading edge.
//
// D-160: the reveal holds a reading pace (~130 characters a second) instead of
// the model's 300+, trailing what arrived by at most 8 s; it goes by whole
// words (a half-typed word at a line end jumped to the next line), and it
// paints only markdown that renders as it will stay (`visibleLength`: whole
// table rows and code lines, a list item with its first word). When the turn
// ends the rest glides in over a few seconds — also across the swap of the live
// turn for its persisted message: the live panel publishes its progress
// (`handoff`) and the persisted panel that mounts with the same text picks the
// reveal up there instead of showing the last thousand characters at once.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { INITIAL_PACER_STATE, advancePacer, flushPacer, visibleLength, type TextPacerState } from '@generatorai/client-core';
import { prefersReducedMotion } from '@/ui/lib/motion.js';

/** Text longer than this when the panel mounts is shown at once, not replayed. */
const MOUNT_REPLAY_LIMIT = 240;

/** Reading pace while text streams, and the longest the reveal may trail what arrived (D-160). */
const STREAM = { drainMs: 1200, maxCharsPerSecond: 130, maxLagMs: 8000 } as const;
/** After the turn ends: the rest catches up, eased, trailing by at most this. */
const END = { drainMs: 600, maxCharsPerSecond: 130, maxLagMs: 1500 } as const;

/**
 * Reveal progress by answer, for the live → persisted swap: keyed by the text's
 * first characters (the same answer in both panels), read by a panel mounting
 * within HANDOFF_MS of the last write.
 */
const handoff = new Map<string, { shown: number; rate: number; at: number }>();
const HANDOFF_MS = 2000;
const HANDOFF_KEY_CHARS = 200;
const handoffKey = (text: string) => text.slice(0, HANDOFF_KEY_CHARS);

function publishProgress(text: string, state: TextPacerState): void {
  const now = performance.now();
  for (const [key, entry] of handoff) if (now - entry.at > HANDOFF_MS) handoff.delete(key);
  if (state.shown < text.length) handoff.set(handoffKey(text), { shown: state.shown, rate: state.rate, at: now });
  else handoff.delete(handoffKey(text));
}

function resumedProgress(text: string): TextPacerState | null {
  const entry = handoff.get(handoffKey(text));
  if (!entry || performance.now() - entry.at > HANDOFF_MS || entry.shown >= text.length) return null;
  return { shown: entry.shown, carry: 0, sinceStep: 0, rate: entry.rate };
}
/** Time constant of the eased reveal rate, and the slowest rate (characters per second). */
const EASE_MS = 400;
const MIN_CHARS_PER_SECOND = 40;

export function usePacedText(text: string, active: boolean, options: { paced?: boolean; flushKey?: unknown } = {}): string {
  const paced = options.paced !== false;
  // A panel mounted in the middle of a long stream (navigating back to a chat)
  // shows what already arrived and paces only what comes next.
  const startPaced = active && paced && text.length < MOUNT_REPLAY_LIMIT;
  // …and one that replaces a live panel mid-reveal (the turn just ended) carries on from where it was.
  const [initial] = useState<TextPacerState>(() =>
    (paced && !active ? resumedProgress(text) : null) ?? (startPaced ? INITIAL_PACER_STATE : flushPacer(text)),
  );
  const [shown, setShown] = useState(initial.shown);
  const stateRef = useRef<TextPacerState>(initial);
  const textRef = useRef(text);
  textRef.current = text;
  // The turn ended with text still to reveal: it catches up quickly instead of landing in one frame.
  const pending = shown < text.length && stateRef.current.shown < text.length;
  const revealing = paced && (active || pending);

  // Flush: pacing is off (the reader looked away) or the view changed.
  const flushKey = options.flushKey;
  useEffect(() => {
    if (paced) return;
    stateRef.current = flushPacer(textRef.current);
    setShown(textRef.current.length);
  }, [paced, text]);
  const flushKeyRef = useRef(flushKey);
  useEffect(() => {
    // A change, not the mount: on mount it flushed the reveal a panel had just started (or resumed).
    if (flushKeyRef.current === flushKey) return;
    flushKeyRef.current = flushKey;
    stateRef.current = flushPacer(textRef.current);
    setShown(textRef.current.length);
  }, [flushKey]);

  // The frame loop runs only while there is something left to reveal.
  useEffect(() => {
    if (!revealing) return undefined;
    if (stateRef.current.shown >= text.length) return undefined;
    let frame = 0;
    let last: number | null = null;
    const reducedMotion = prefersReducedMotion();
    const pace = active ? STREAM : END;
    const tick = (now: number) => {
      if (typeof document !== 'undefined' && document.hidden) {
        stateRef.current = flushPacer(textRef.current);
        setShown(textRef.current.length);
        return;
      }
      const dt = last === null ? 1000 / 60 : now - last;
      last = now;
      const next = advancePacer(stateRef.current, textRef.current, dt, {
        reducedMotion,
        ...pace,
        easeMs: EASE_MS,
        minCharsPerSecond: MIN_CHARS_PER_SECOND,
      });
      stateRef.current = next;
      publishProgress(textRef.current, next);
      setShown(next.shown);
      if (next.shown < textRef.current.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [revealing, active, text]);

  return revealing ? text.slice(0, visibleLength(text, shown, !active)) : text;
}
