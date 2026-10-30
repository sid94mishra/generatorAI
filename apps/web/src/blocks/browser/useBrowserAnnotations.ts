// ────────────────────────────────────────────────────────────────
// Browser comments and screenshots (D-140, D-145).
//
// Native desktop: the toolbar's ↖ turns on select mode — the page outlines
// what is under the pointer; a click selects an element, a drag an area. The
// selection comes back as `pending`, the Comments panel opens with the same
// form as a Changes review comment, and saving pins it numbered on the page.
// Comments are listed in the panel: edit, attach to the message or send one;
// attach or send all. Leaving select mode keeps the comments.
// Screenshot: the visible area, the full page, or a dragged area, attached to
// the message.
//
// Web (screencast): ↖ is the server-driven inspector (one pick becomes an
// element reference); Screenshot offers the dragged area on the live view
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
  const [pending, setPending] = useState<AnnotationSummary | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
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
    if (res) { setItems(res.items); setPending(res.pending); }
  }, [native, nativeTabId]);

  const stopAnnotate = useCallback(async () => {
    const nb = nativeBrowserBridge();
    if (native && nb?.annotateStop) await nb.annotateStop(nativeTabId!).catch(() => undefined);
    setAnnotateOn(false);
    setPending(null);
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
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }, [native, nativeTabId, sending, onSend, onCapture, flash, refresh, setError]);

  /** Save the comment on a selection (new or edited); `sendNow` sends just that one at once. */
  const saveComment = useCallback(async (key: string, body: string, intent: string, sendNow = false) => {
    const nb = nativeBrowserBridge();
    if (!native || !nb?.annotateSave) return;
    const ok = await nb.annotateSave(nativeTabId!, key, body, intent).catch(() => false);
    if (!ok) { setError('That selection is gone — the page may have changed. Select it again.'); return; }
    setPending(null);
    await refresh();
    if (sendNow) await send('now', [key]);
  }, [native, nativeTabId, refresh, send, setError]);

  const cancelPending = useCallback(async () => {
    const nb = nativeBrowserBridge();
    if (pending && native && nb?.annotateCancel) await nb.annotateCancel(nativeTabId!, pending.key).catch(() => undefined);
    setPending(null);
  }, [pending, native, nativeTabId]);

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
          setPanelOpen(true);
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

  // Keep the panel in step with the page while select mode is on or comments
  // exist; a new selection opens the panel; Esc in the page leaves the mode.
  const tracking = native && open && (annotateOn || items.length > 0);
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
        setPending((prev) => (prev?.key === res.pending?.key && prev?.label === res.pending?.label ? prev : res.pending));
        if (res.pending) setPanelOpen(true);
        if (res.exit) void stopAnnotate();
      }
      timer = setTimeout(() => void tick(), ANNOTATE_POLL_MS);
    };
    void tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [tracking, nativeTabId, stopAnnotate]);

  /** Show a comment's element on the page (scrolled into view, outline flashed). */
  const showComment = useCallback(async (key: string) => {
    const nb = nativeBrowserBridge();
    if (!native || !nb?.annotateOpen) return;
    await nb.annotateOpen(nativeTabId!, key).catch(() => undefined);
  }, [native, nativeTabId]);

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
    setPending(null);
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
        // The menu that asked for this is an overlay, and an overlay hides
        // the native view (D-19); the capture waits for the page to be back.
        let shot = null;
        for (let attempt = 0; attempt < 6 && !shot; attempt++) {
          await new Promise((r) => setTimeout(r, attempt === 0 ? 150 : 250));
          shot = await nb.capture(nativeTabId!, kind);
        }
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
    annotateOn, items, pending, sending, notice, panelOpen, setPanelOpen,
    toggleAnnotate, send, saveComment, cancelPending, showComment, removeComment, clearComments, screenshot,
  };
}
