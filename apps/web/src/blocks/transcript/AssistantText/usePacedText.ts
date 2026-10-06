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
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { INITIAL_PACER_STATE, advancePacer, flushPacer, type TextPacerState } from '@generatorai/client-core';
import { prefersReducedMotion } from '@/ui/lib/motion.js';

/** Text longer than this when the panel mounts is shown at once, not replayed. */
const MOUNT_REPLAY_LIMIT = 240;

/** While text streams, a burst is shown within this; after the turn ends the rest catches up within END_DRAIN_MS. */
const STREAM_DRAIN_MS = 900;
const END_DRAIN_MS = 250;

export function usePacedText(text: string, active: boolean, options: { paced?: boolean; flushKey?: unknown } = {}): string {
  const paced = options.paced !== false;
  // A panel mounted in the middle of a long stream (navigating back to a chat)
  // shows what already arrived and paces only what comes next.
  const startPaced = active && paced && text.length < MOUNT_REPLAY_LIMIT;
  const [shown, setShown] = useState(() => (startPaced ? 0 : text.length));
  const stateRef = useRef<TextPacerState>(startPaced ? INITIAL_PACER_STATE : flushPacer(text));
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
  useEffect(() => {
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
    const drainMs = active ? STREAM_DRAIN_MS : END_DRAIN_MS;
    const tick = (now: number) => {
      if (typeof document !== 'undefined' && document.hidden) {
        stateRef.current = flushPacer(textRef.current);
        setShown(textRef.current.length);
        return;
      }
      const dt = last === null ? 1000 / 60 : now - last;
      last = now;
      const next = advancePacer(stateRef.current, textRef.current, dt, { reducedMotion, drainMs });
      stateRef.current = next;
      setShown(next.shown);
      if (next.shown < textRef.current.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [revealing, active, text]);

  return revealing ? text.slice(0, Math.min(shown, text.length)) : text;
}
