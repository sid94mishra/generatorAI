// ────────────────────────────────────────────────────────────────
// Region capture on the screencast live view: drag a rectangle (≥ 8×8 CSS
// px), the server crops the page to it and the PNG is attached to chat.
// ────────────────────────────────────────────────────────────────

import { useCallback, useRef, useState } from 'react';

import { captureBrowserRegion } from './browserApi.js';
import { dragRect, isCaptureRectUsable, viewRectToPageClip, type ViewRect } from './browserInput.js';
import type { BrowserCaptureHandler } from './useBrowserAnnotations.js';

export interface BrowserCaptureOptions {
  workspaceId: string | undefined;
  captureMode: boolean;
  setCaptureMode: (on: boolean) => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onCapture: BrowserCaptureHandler | undefined;
  setError: (message: string | null) => void;
}

export function useBrowserCapture({ workspaceId, captureMode, setCaptureMode, canvasRef, onCapture, setError }: BrowserCaptureOptions) {
  /** Rectangle currently being drawn (CSS px, relative to the live <canvas>). */
  const [captureRect, setCaptureRect] = useState<ViewRect | null>(null);
  const captureStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleCaptureMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!captureMode) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    captureStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setCaptureRect({ x: captureStartRef.current.x, y: captureStartRef.current.y, w: 0, h: 0 });
  }, [captureMode]);

  const handleCaptureMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!captureMode || !captureStartRef.current) return;
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    setCaptureRect(dragRect(captureStartRef.current, e.clientX - rect.left, e.clientY - rect.top));
  }, [captureMode]);

  const handleCaptureMouseUp = useCallback(async () => {
    if (!captureMode || !captureStartRef.current || !workspaceId) {
      captureStartRef.current = null;
      return;
    }
    const rect = captureRect;
    captureStartRef.current = null;
    setCaptureRect(null);
    setCaptureMode(false);
    if (!isCaptureRectUsable(rect)) return; // ignore stray clicks
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width || !canvas.height) return;
    // Map the CSS-px rect on the letterboxed <canvas> to page coords.
    const clip = viewRectToPageClip(rect, canvas.getBoundingClientRect(), canvas);
    try {
      const blob = await captureBrowserRegion(workspaceId, clip);
      const file = new File([blob], `capture-${Date.now()}.png`, { type: 'image/png' });
      onCapture?.(file, 'screenshot');
    } catch (err) { setError((err as Error).message); }
  }, [captureMode, captureRect, workspaceId, onCapture, setCaptureMode, canvasRef, setError]);

  return { captureRect, handleCaptureMouseDown, handleCaptureMouseMove, handleCaptureMouseUp };
}
