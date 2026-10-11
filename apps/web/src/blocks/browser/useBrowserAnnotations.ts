// ────────────────────────────────────────────────────────────────
// Annotate mode, comments and screenshots (D-140).
//
// Native desktop: Annotate injects the in-page overlay (hover, click an
// element or drag an area, comment in an anchored card). The saved comments
// are listed in the dock's tray, polled from the page; the tray sends them —
// "Send to agent" (one message, now) or "Add to message" (into the composer).
// Leaving the mode keeps the comments: the pins hide, the tray stays.
// Screenshot: the visible area, the full page, or a dragged area, attached to
// the message.
//
// Web (screencast): Annotate is the server-driven inspector (one pick becomes
// an element reference); Screenshot offers the dragged area on the live view
// (useBrowserCapture).
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnnotationPalette } from '@generatorai/design-tokens';

import { postBrowserAction } from './browserApi.js';
import { commentFiles, dataUrlFile, fileStamp, type AnnotationSummary } from './browserAnnotations.js';
import { nativeBrowserBridge } from './nativeBrowserBridge.js';

export type BrowserCaptureKind = 'selection' | 'screenshot' | 'dom';
export type BrowserCaptureHandler = (file: File, kind: BrowserCaptureKind) => void;
/** Send files as a message now. Resolves to what happened: a busy chat attaches them to the next message instead. */
export type BrowserSendHandler = (files: File[]) => Promise<'sent' | 'attached'>;
export type BrowserScreenshotKind = 'visible' | 'full' | 'area';

/** Comment list refresh cadence while there is anything to track. */
export const ANNOTATE_POLL_MS = 400;
/** How long the tray shows what a send did. */
const NOTICE_MS = 3500;

export interface BrowserAnnotationsOptions {
  open: boolean;
  workspaceId: string | undefined;
  nativeTabId: string | null;
  nativeAvailable: boolean;
  /** Colours of the injected overlay: `annotationPalette(themeId, appearance)`. */
  palette: AnnotationPalette;
  onCapture: BrowserCaptureHandler | undefined;
  onSend: BrowserSendHandler | undefined;
  setError: (message: string | null) => void;
}

export function useBrowserAnnotations({
  open, workspaceId, nativeTabId, nativeAvailable, palette, onCapture, onSend, setError,
}: BrowserAnnotationsOptions) {
  const [inspectorOn, setInspectorOn] = useState(false);
  const [captureMode, setCaptureMode] = useState(false);
  const [annotateOn, setAnnotateOn] = useState(false);
  const [items, setItems] = useState<AnnotationSummary[]>([]);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  const native = nativeAvailable && !!nativeTabId;
  const flash = useCallback((text: string) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const refresh = useCallback(async () => {
    const nb = nativeBrowserBridge();
    if (!native || !nb?.annotatePoll) return;
    const res = await nb.annotatePoll(nativeTabId!).catch(() => null);
    if (res) setItems(res.items);
  }, [native, nativeTabId]);

  const stopAnnotate = useCallback(async () => {
    const nb = nativeBrowserBridge();
    if (native && nb?.annotateStop) await nb.annotateStop(nativeTabId!).catch(() => undefined);
    setAnnotateOn(false);
  }, [native, nativeTabId]);

  /** Send comments (all, or `keys`): now as a message, or into the composer. */
  const send = useCallback(async (how: 'now' | 'message', keys?: string[]) => {
    const nb = nativeBrowserBridge();
    if (!native || !nb?.annotateSend || sending) return;
    setSending(true);
    try {
      const sent = await nb.annotateSend(nativeTabId!, keys);
      const files = commentFiles(sent, fileStamp());
      const n = sent.length;
      if (files.length === 0) return;
      const what = `${n} comment${n === 1 ? '' : 's'}`;
      if (how === 'now' && onSend) {
        const result = await onSend(files);
        flash(result === 'sent' ? `Sent ${what} to the agent` : `The agent is busy — ${what} added to your next message`);
      } else {
        for (const f of files) onCapture?.(f, f.type === 'image/png' ? 'screenshot' : 'selection');
        flash(`Added ${what} to your message`);
      }
      await stopAnnotate();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }, [native, nativeTabId, sending, onSend, onCapture, flash, stopAnnotate, refresh, setError]);

  const toggleAnnotate = useCallback(async () => {
    if (!workspaceId) return;
    const nb = nativeBrowserBridge();
    if (native && nb?.annotateStart) {
      try {
        if (annotateOn) {
          await stopAnnotate();
        } else {
          setCaptureMode(false);
          await nb.annotateStart(nativeTabId!, palette);
          setAnnotateOn(true);
        }
      } catch (err) { setError((err as Error).message); }
      return;
    }
    // Web / screencast: the server-driven inspector (one pick → an element reference).
    const next = !inspectorOn;
    try {
      if (next) setCaptureMode(false);
      await postBrowserAction(workspaceId, { kind: 'inspector', on: next });
      setInspectorOn(next);
    } catch (err) { setError((err as Error).message); }
  }, [workspaceId, native, annotateOn, nativeTabId, palette, inspectorOn, stopAnnotate, setError]);

  // Keep the tray in step with the page while the mode is on or comments
  // exist, and act on the overlay's requests (Esc → leave, ⌘↵ → send all).
  const tracking = native && open && (annotateOn || items.length > 0);
  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; }, [send]);
  useEffect(() => {
    if (!tracking) return;
    const nb = nativeBrowserBridge();
    if (!nb?.annotatePoll) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      const res = await nb.annotatePoll(nativeTabId!).catch(() => null);
      if (cancelled) return;
      if (res) {
        setItems(res.items);
        if (res.sendAll && res.items.length > 0) void sendRef.current('now');
        else if (res.exit) void stopAnnotate();
      }
      timer = setTimeout(() => void tick(), ANNOTATE_POLL_MS);
    };
    void tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [tracking, nativeTabId, stopAnnotate]);

  const openComment = useCallback(async (key: string) => {
    const nb = nativeBrowserBridge();
    if (!native || !nb?.annotateOpen) return;
    if (!annotateOn && nb.annotateStart) {
      await nb.annotateStart(nativeTabId!, palette).catch(() => undefined);
      setAnnotateOn(true);
    }
    await nb.annotateOpen(nativeTabId!, key).catch(() => undefined);
  }, [native, nativeTabId, annotateOn, palette]);

  const removeComment = useCallback(async (key: string) => {
    const nb = nativeBrowserBridge();
    if (!native || !nb?.annotateRemove) return;
    await nb.annotateRemove(nativeTabId!, key).catch(() => undefined);
    await refresh();
  }, [native, nativeTabId, refresh]);

  const clearComments = useCallback(async () => {
    const nb = nativeBrowserBridge();
    if (!native || !nb?.annotateClear) return;
    await nb.annotateClear(nativeTabId!).catch(() => undefined);
    setItems([]);
  }, [native, nativeTabId]);

  /** A screenshot into the message: the viewport, the whole page, or a dragged area. */
  const screenshot = useCallback(async (kind: BrowserScreenshotKind) => {
    const nb = nativeBrowserBridge();
    if (native && nb) {
      try {
        if (annotateOn) await stopAnnotate();
        const stamp = fileStamp();
        if (kind === 'area') {
          const dataUrl = await nb.captureRegion(nativeTabId!, palette);
          if (!dataUrl) return;
          onCapture?.(dataUrlFile(dataUrl, `screenshot-area-${stamp}.png`), 'screenshot');
          flash('Added the area screenshot to your message');
          return;
        }
        const shot = await nb.capture(nativeTabId!, kind);
        if (!shot) { setError('Could not capture the page. Make sure the browser tab is visible.'); return; }
        onCapture?.(dataUrlFile(shot.dataUrl, `screenshot-${shot.mode === 'full' ? 'full-page' : 'visible'}-${stamp}.png`), 'screenshot');
        flash(kind === 'full' && shot.mode !== 'full'
          ? 'Full page was unavailable — added the visible area instead'
          : `Added the ${shot.mode === 'full' ? 'full-page' : 'visible-area'} screenshot to your message`);
      } catch (err) { setError((err as Error).message); }
      return;
    }
    // Web / screencast: only the dragged area (drawn on the live view).
    if (kind !== 'area') return;
    setCaptureMode((v) => {
      const next = !v;
      if (next && inspectorOn) {
        setInspectorOn(false);
        if (workspaceId) void postBrowserAction(workspaceId, { kind: 'inspector', on: false }).catch(() => undefined);
      }
      return next;
    });
  }, [native, nativeTabId, palette, annotateOn, stopAnnotate, onCapture, flash, inspectorOn, workspaceId, setError]);

  // Leave the mode when the panel closes or the workspace changes, so the
  // overlay never lingers on a hidden view. Comments stay on the page.
  useEffect(() => {
    if (open) return;
    if (annotateOn) void stopAnnotate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId]);

  return {
    inspectorOn, setInspectorOn,
    captureMode, setCaptureMode,
    annotateOn, items, sending, notice,
    toggleAnnotate, send, openComment, removeComment, clearComments, screenshot,
  };
}
