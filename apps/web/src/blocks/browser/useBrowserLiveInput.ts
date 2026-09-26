// ────────────────────────────────────────────────────────────────
// Live-view input: mouse / wheel / keyboard on the screencast `<canvas>` and
// the overlay scrollbar drag, mapped through browserInput.ts and sent over
// the live stream's input channel.
//
// Without full interactivity (web, setting off) only Inspect clicks, hover
// moves while inspecting, and scrolling reach the page.
// ────────────────────────────────────────────────────────────────

import { useCallback, useRef } from 'react';

import type { BrowserScrollState } from './browserApi.js';
import {
  clickInput,
  clientToPagePoint,
  keyInput,
  MOUSE_MOVE_THROTTLE_MS,
  moveInput,
  scrollDragTarget,
  wheelInput,
  type BrowserInputEvent,
  type PagePoint,
} from './browserInput.js';

export interface BrowserLiveInputOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  sendInput: (event: BrowserInputEvent) => Promise<void>;
  inspectorOn: boolean;
  fullInteractivity: boolean;
  scrollState: BrowserScrollState | null;
  setScrollState: React.Dispatch<React.SetStateAction<BrowserScrollState | null>>;
}

export function useBrowserLiveInput({ canvasRef, sendInput, inspectorOn, fullInteractivity, scrollState, setScrollState }: BrowserLiveInputOptions) {
  const eventToPageCoords = useCallback((e: { clientX: number; clientY: number }): PagePoint | null => {
    // On a canvas the attribute size IS the intrinsic size, and
    // `object-contain` letterboxes it inside the element's box.
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width || !canvas.height) return null;
    return clientToPagePoint(e, canvas.getBoundingClientRect(), canvas);
  }, [canvasRef]);

  const handleLiveClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Inspect mode: allow click regardless of interactivity — this is
    // the only way to attach elements when interactivity is off.
    if (!inspectorOn && !fullInteractivity) return;
    const p = eventToPageCoords(e);
    if (!p) return;
    try { (e.currentTarget as HTMLCanvasElement).focus(); } catch { /* ignore */ }
    void sendInput(clickInput(p, e.button, e.detail));
  }, [eventToPageCoords, sendInput, inspectorOn, fullInteractivity]);

  const handleLiveWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    // Scroll is always allowed — even under restricted interactivity, the
    // user needs to see below the fold to guide the agent.
    void sendInput(wheelInput(eventToPageCoords(e), e.deltaX, e.deltaY));
  }, [eventToPageCoords, sendInput]);

  const handleLiveMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Skip mouse.move if interactivity is off (no click follow-up will
    // happen anyway). We still send hover-only moves when inspect is on so
    // the highlighter overlay tracks correctly.
    if (!fullInteractivity && !inspectorOn) return;
    const now = performance.now();
    const w = window as unknown as { __gaiLastMouseMove?: number };
    if (w.__gaiLastMouseMove && now - w.__gaiLastMouseMove < MOUSE_MOVE_THROTTLE_MS) return;
    w.__gaiLastMouseMove = now;
    const p = eventToPageCoords(e);
    if (!p) return;
    void sendInput(moveInput(p));
  }, [eventToPageCoords, sendInput, fullInteractivity, inspectorOn]);

  const handleLiveKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!fullInteractivity) return;
    const input = keyInput(e);
    if (!input) return; // F5 / F12 stay with the host
    e.preventDefault();
    void sendInput(input);
  }, [sendInput, fullInteractivity]);

  // ── Overlay scrollbar drag ────────────────────────────
  const scrollBarRef = useRef<HTMLDivElement | null>(null);
  const scrollDragRef = useRef<{ startY: number; startScrollY: number } | null>(null);

  const handleScrollThumbDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    if (!scrollState) return;
    scrollDragRef.current = { startY: e.clientY, startScrollY: scrollState.scrollY };
    // Mouseup on window (not on thumb) so a fast release outside the pill
    // still commits.
    const onMove = (ev: MouseEvent): void => {
      if (!scrollDragRef.current || !scrollBarRef.current || !scrollState) return;
      const track = scrollBarRef.current.getBoundingClientRect();
      const targetY = scrollDragTarget(scrollState, scrollDragRef.current.startScrollY, ev.clientY - scrollDragRef.current.startY, track.height);
      if (targetY === null) return;
      // Send a wheel event at the delta so Chromium performs a native
      // smooth scroll. Delta = new_target - current_scrollY.
      void sendInput({ type: 'mouse.wheel', deltaX: 0, deltaY: targetY - scrollState.scrollY });
      // Optimistic update so the thumb tracks the pointer.
      setScrollState((s) => s ? { ...s, scrollY: targetY } : s);
    };
    const onUp = (): void => {
      scrollDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [scrollState, sendInput, setScrollState]);

  return {
    handleLiveClick, handleLiveWheel, handleLiveMouseMove, handleLiveKeyDown,
    scrollBarRef, handleScrollThumbDown,
  };
}
