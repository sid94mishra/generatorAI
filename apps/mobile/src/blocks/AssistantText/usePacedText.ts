// The streaming text a mobile panel paints, revealed by the shared pacer (client-core `advancePacer`, D-91) one
// frame at a time — the same cadence as web. `text` (everything that arrived) stays the source of truth; the reveal
// catches up within 250 ms when the turn ends and shows everything when the app goes to the background. Reduced motion reveals bursts in steps.
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { INITIAL_PACER_STATE, advancePacer, flushPacer, type TextPacerState } from '@generatorai/client-core';

import { useReduceMotion } from '../../ui/platform/motion';

/** Text longer than this when the view mounts is shown at once, not replayed. */
const MOUNT_REPLAY_LIMIT = 240;

/** While text streams a burst is shown within this; after the turn ends the rest catches up within END_DRAIN_MS. */
const STREAM_DRAIN_MS = 900;
const END_DRAIN_MS = 250;

export function usePacedText(text: string, active: boolean): string {
  const reducedMotion = useReduceMotion();
  const startPaced = active && text.length < MOUNT_REPLAY_LIMIT;
  const [shown, setShown] = useState(() => (startPaced ? 0 : text.length));
  const stateRef = useRef<TextPacerState>(startPaced ? INITIAL_PACER_STATE : flushPacer(text));
  const textRef = useRef(text);
  // `shown` mirrors stateRef.current.shown (both are written together), so render reads only state.
  const revealing = active || shown < text.length;

  // Declared first so the frame loop and the background flush below always read the latest text.
  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') return;
      stateRef.current = flushPacer(textRef.current);
      setShown(textRef.current.length);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!revealing || stateRef.current.shown >= text.length) return undefined;
    let frame = 0;
    let last: number | null = null;
    const drainMs = active ? STREAM_DRAIN_MS : END_DRAIN_MS;
    const tick = (now: number) => {
      const dt = last === null ? 1000 / 60 : now - last;
      last = now;
      const next = advancePacer(stateRef.current, textRef.current, dt, { reducedMotion, drainMs });
      stateRef.current = next;
      setShown(next.shown);
      if (next.shown < textRef.current.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [revealing, active, text, reducedMotion]);

  return revealing ? text.slice(0, Math.min(shown, text.length)) : text;
}
