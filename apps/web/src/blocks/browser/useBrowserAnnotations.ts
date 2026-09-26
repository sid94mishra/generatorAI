// ────────────────────────────────────────────────────────────────
// Inspect / comment / capture modes.
//
// Web (screencast): Inspect turns on the server-driven inspector overlay; a
// pick arrives as a `browser.selection` event. Capture draws a rectangle on
// the live view (useBrowserCapture). The two are mutually exclusive.
//
// Native desktop: Inspect toggles in-page annotation (comment pins): a
// theme-matched review overlay injected INTO the page (the WCV paints on top
// of the DOM, so the comment UI must live inside the page). The user drops
// pins, types a note and presses Add; the toolbar Comments popover lists and
// sends them. Capture there drags a region that becomes an annotation too.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';

import { postBrowserAction } from './browserApi.js';
import {
  annotationFileStem,
  annotationMarkdownFile,
  annotationScreenshotFile,
  type AnnotationSummary,
  type PickedElement,
} from './browserAnnotations.js';
import { nativeBrowserBridge } from './nativeBrowserBridge.js';

export type BrowserCaptureKind = 'selection' | 'screenshot' | 'dom';
export type BrowserCaptureHandler = (file: File, kind: BrowserCaptureKind) => void;

/** Annotation list refresh cadence while comment mode is on. */
export const ANNOTATE_POLL_MS = 400;

export interface BrowserAnnotationsOptions {
  open: boolean;
  workspaceId: string | undefined;
  nativeTabId: string | null;
  nativeAvailable: boolean;
  /** Theme of the injected review overlay. */
  theme: 'light' | 'dark';
  onCapture: BrowserCaptureHandler | undefined;
  setError: (message: string | null) => void;
}

export function useBrowserAnnotations({ open, workspaceId, nativeTabId, nativeAvailable, theme, onCapture, setError }: BrowserAnnotationsOptions) {
  const [inspectorOn, setInspectorOn] = useState(false);
  const [captureMode, setCaptureMode] = useState(false);
  // In-page annotation (comment pins) mode + live list (native desktop).
  const [annotateOn, setAnnotateOn] = useState(false);
  const [annotateItems, setAnnotateItems] = useState<AnnotationSummary[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);

  // Build chat attachments from a drained annotation (element summary +
  // the user's requested change as Markdown, plus a cropped screenshot).
  const attachAnnotation = useCallback((p: PickedElement) => {
    const stem = annotationFileStem(p, `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    onCapture?.(annotationMarkdownFile(p, stem), 'selection');
    if (p.screenshot) {
      try {
        onCapture?.(annotationScreenshotFile(p.screenshot, stem), 'screenshot');
      } catch { /* ignore */ }
    }
  }, [onCapture]);

  const handleToggleInspector = useCallback(async () => {
    if (!workspaceId) return;
    const nb = nativeBrowserBridge();
    if (nativeAvailable && nativeTabId && nb?.annotateStart) {
      const next = !annotateOn;
      try {
        if (next) {
          setCaptureMode(false);
          await nb.annotateStart(nativeTabId, theme);
        } else {
          await nb.annotateStop(nativeTabId);
          setAnnotateItems([]);
          setCommentsOpen(false);
        }
        setAnnotateOn(next);
      } catch (err) { setError((err as Error).message); }
      return;
    }
    // Web / screencast path — server-driven inspector overlay.
    const nextI = !inspectorOn;
    try {
      if (nextI) setCaptureMode(false);
      await postBrowserAction(workspaceId, { kind: 'inspector', on: nextI });
      setInspectorOn(nextI);
    } catch (err) { setError((err as Error).message); }
  }, [workspaceId, inspectorOn, nativeAvailable, annotateOn, theme, nativeTabId, setError]);

  // Poll the in-page overlay while annotate mode is on: keep the toolbar
  // count badge + Comments popover list in sync as the user adds/removes.
  useEffect(() => {
    if (!annotateOn || !workspaceId || !nativeAvailable || !nativeTabId) return;
    const nb = nativeBrowserBridge();
    if (!nb?.annotatePoll) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const res = await nb.annotatePoll(nativeTabId);
        if (!cancelled && res) {
          setAnnotateItems(Array.isArray(res.items) ? res.items : []);
          // Single-off sends: the user pressed "Send" on a card in-page.
          for (const item of res.sent ?? []) attachAnnotation(item as PickedElement);
        }
      } catch { /* ignore */ }
      if (!cancelled) timer = setTimeout(tick, ANNOTATE_POLL_MS);
    };
    void tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [annotateOn, workspaceId, nativeAvailable, nativeTabId, attachAnnotation]);

  // Send annotations to chat: drain the given keys (or all commented ones),
  // which removes them from the page so they can't be added twice, then
  // attach each as a Markdown context file + cropped screenshot.
  const sendAnnotations = useCallback(async (keys?: string[]) => {
    const nb = nativeBrowserBridge();
    if (!nativeAvailable || !nativeTabId || !nb?.annotateSend) return;
    try {
      const items = await nb.annotateSend(nativeTabId, keys);
      for (const item of items ?? []) attachAnnotation(item as PickedElement);
      const res = await nb.annotatePoll(nativeTabId);
      setAnnotateItems(Array.isArray(res?.items) ? res.items : []);
      if (!res || res.total === 0) setCommentsOpen(false);
    } catch (err) { setError((err as Error).message); }
  }, [nativeAvailable, nativeTabId, attachAnnotation, setError]);

  const removeAnnotation = useCallback(async (key: string) => {
    const nb = nativeBrowserBridge();
    if (!nativeAvailable || !nativeTabId || !nb?.annotateRemove) return;
    try {
      await nb.annotateRemove(nativeTabId, key);
      const res = await nb.annotatePoll(nativeTabId);
      setAnnotateItems(Array.isArray(res?.items) ? res.items : []);
    } catch { /* ignore */ }
  }, [nativeAvailable, nativeTabId]);

  const clearAnnotations = useCallback(async () => {
    const nb = nativeBrowserBridge();
    if (!nativeAvailable || !nativeTabId || !nb?.annotateClear) return;
    try {
      await nb.annotateClear(nativeTabId);
      setAnnotateItems([]);
      setCommentsOpen(false);
    } catch { /* ignore */ }
  }, [nativeAvailable, nativeTabId]);

  // Exit annotate mode when the panel closes or the workspace changes, so
  // the in-page overlay doesn't linger on a hidden/other view.
  useEffect(() => {
    if (open) return;
    const nb = nativeBrowserBridge();
    if (annotateOn && nb?.annotateStop && nativeTabId) void nb.annotateStop(nativeTabId).catch(() => undefined);
    setAnnotateOn(false);
    setAnnotateItems([]);
    setCommentsOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId]);

  const handleToggleCapture = useCallback(async () => {
    // Native desktop: drag-to-select a region becomes a comment annotation
    // (same as element pick) — the user drags a box, then adds a note and
    // sends it from the Comments popover. Requires annotate mode; enable it.
    const nb = nativeBrowserBridge();
    if (nativeAvailable && nativeTabId && nb?.annotateRegion) {
      try {
        if (!annotateOn) { await nb.annotateStart(nativeTabId, theme); setAnnotateOn(true); }
        setInspectorOn(false);
        await nb.annotateRegion(nativeTabId);
      } catch (err) { setError((err as Error).message); }
      return;
    }
    // Web / screencast path — draw the rectangle on the live view.
    setCaptureMode((v) => {
      const next = !v;
      if (next && inspectorOn) {
        setInspectorOn(false);
        if (workspaceId) void postBrowserAction(workspaceId, { kind: 'inspector', on: false }).catch(() => undefined);
      }
      return next;
    });
  }, [workspaceId, inspectorOn, nativeAvailable, annotateOn, theme, nativeTabId, setError]);

  return {
    inspectorOn, setInspectorOn,
    captureMode, setCaptureMode,
    annotateOn, annotateItems,
    commentsOpen, setCommentsOpen,
    handleToggleInspector, handleToggleCapture,
    sendAnnotations, removeAnnotation, clearAnnotations,
  };
}
