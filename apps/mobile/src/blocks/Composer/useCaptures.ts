// ────────────────────────────────────────────────────────────────
// useCaptures — fetch terminal / browser content and hand it to the composer.
//
// Endpoints (all under the workspace, gated server-side by exec:terminal /
// exec:browser — the same scopes the panes need):
//   GET  /terminals                                   alive shells
//   GET  /terminals/:sid/scrollback?format=text&tailLines=N
//        (409 UNSUPPORTED on a host with no VT model → raw `tailBytes`
//         fallback, de-escaped here)
//   GET  /browser/descriptor                          ready + viewport
//   POST /browser/capture {clip}                      PNG of the viewport
//   POST /browser/read-page                           {url,title,snapshot}
//
// Where a capture lands is decided by `captureDestination`: an attachment
// when this device may upload, otherwise text goes into the draft and a
// screenshot is refused with the reason.
// ────────────────────────────────────────────────────────────────

import { useCallback, useMemo } from 'react';
import { ApiError, createApiClient, createAdminApi } from '@generatorai/client-core';

import { shortError } from '../../services/lib/shortError';
import { bytesToBase64, utf8Decode } from '../../services/lib/base64';
import { currentTerminalSelection, pickCaptureSession } from '../../services/terminal/terminalFocus';
import {
  captureDestination,
  formatPageText,
  formatTerminalLines,
  fullFrameClip,
  pageCaptureName,
  plainTextFromPty,
  terminalCaptureName,
  type CaptureInput,
  type TerminalCaptureLines,
} from './model/captures';
import type { ComposerCaptureActions } from './model/captureContext';

type Toast = (request: { message: string; variant?: 'info' | 'success' | 'warning' | 'danger'; duration?: number }) => void;

export interface UseCapturesOptions {
  workspaceId: string | null | undefined;
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>;
  uploadAvailable: boolean;
  uploadReason: string | null;
  /** Validate + add; returns false (having toasted) when refused. */
  attach: (input: CaptureInput) => boolean;
  /** Insert a text capture into the draft. */
  insertText: (label: string, text: string) => void;
  setBusy: (busy: boolean) => void;
  toast: Toast;
  /** After a capture landed — the screen brings the chat page forward. */
  onCaptured?: (() => void) | undefined;
}

export function useCaptures(opts: UseCapturesOptions): ComposerCaptureActions {
  const { workspaceId, authedFetch, uploadAvailable, uploadReason, attach, insertText, setBusy, toast, onCaptured } = opts;
  const api = useMemo(() => createApiClient(authedFetch), [authedFetch]);
  const admin = useMemo(() => createAdminApi(authedFetch), [authedFetch]);

  const deliver = useCallback(
    (input: CaptureInput) => {
      const destination = captureDestination(input, uploadAvailable);
      if (destination === 'attach') {
        if (attach(input)) onCaptured?.();
        return;
      }
      if (destination === 'draft' && input.kind === 'text') {
        insertText(input.label, input.text);
        toast({ message: `${input.label} added to your message.`, variant: 'success' });
        onCaptured?.();
        return;
      }
      toast({
        message: `${input.label} can only be sent as an attachment. ${uploadReason ?? 'Attachments are not permitted on this device.'}`,
        variant: 'warning',
        duration: 5000,
      });
    },
    [uploadAvailable, uploadReason, attach, insertText, toast, onCaptured],
  );

  const run = useCallback(
    async (work: () => Promise<void>, fallback: string) => {
      setBusy(true);
      try {
        await work();
      } catch (err) {
        toast({ message: shortError(err, fallback), variant: 'danger' });
      } finally {
        setBusy(false);
      }
    },
    [setBusy, toast],
  );

  const captureTerminalOutput = useCallback(
    (lines: TerminalCaptureLines, sessionId?: string) =>
      run(async () => {
        if (!workspaceId) throw new Error('This chat has no workspace yet.');
        let sid = sessionId ?? null;
        if (!sid) {
          const terminals = await admin.terminals.list(encodeURIComponent(workspaceId));
          const alive = terminals.filter((d) => d.exitCode === null).map((d) => d.id);
          sid = pickCaptureSession(workspaceId, alive);
        }
        if (!sid) {
          toast({ message: 'No terminal is open in this workspace. Open one from the Terminal pane.', variant: 'info' });
          return;
        }
        let text: string;
        try {
          const body = await api.resources.terminalLines(workspaceId, sid, lines);
          text = formatTerminalLines(body.lines ?? []);
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409) throw error;
          // Hosts without a VT model expose their raw scrollback instead.
          const raw = await api.resources.terminalBytes(workspaceId, sid, lines * 400);
          text = plainTextFromPty(utf8Decode(raw.data), lines).join('\n');
        }
        if (!text) {
          toast({ message: 'The terminal has no output yet.', variant: 'info' });
          return;
        }
        deliver({
          source: 'terminal',
          kind: 'text',
          name: terminalCaptureName('output'),
          mimeType: 'text/plain',
          text,
          label: `Terminal output (last ${lines} lines)`,
        });
      }, 'Could not capture the terminal'),
    [run, workspaceId, api, admin, toast, deliver],
  );

  const captureTerminalSelection = useCallback(
    (text: string) => {
      const selection = text.trim() ? text : (workspaceId ? currentTerminalSelection(workspaceId) : null) ?? '';
      if (!selection.trim()) {
        toast({ message: 'Long-press text in the terminal to select it first.', variant: 'info' });
        return;
      }
      deliver({
        source: 'terminal',
        kind: 'text',
        name: terminalCaptureName('selection'),
        mimeType: 'text/plain',
        text: selection,
        label: 'Terminal selection',
      });
    },
    [workspaceId, toast, deliver],
  );

  const readDescriptor = useCallback(() => api.resources.browserDescriptor(workspaceId!), [api, workspaceId]);

  const captureBrowserScreenshot = useCallback(
    () =>
      run(async () => {
        if (!workspaceId) throw new Error('This chat has no workspace yet.');
        if (!uploadAvailable) {
          toast({
            message: `A screenshot can only be sent as an attachment. ${uploadReason ?? 'Attachments are not permitted on this device.'}`,
            variant: 'warning',
            duration: 5000,
          });
          return;
        }
        const descriptor = await readDescriptor();
        if (!descriptor.ready) {
          toast({ message: 'The browser is not running. Start it from the Browser pane.', variant: 'info' });
          return;
        }
        const { data: bytes } = await api.resources.browserCapture(workspaceId, fullFrameClip(descriptor.viewport));
        deliver({
          source: 'browser',
          kind: 'image',
          name: pageCaptureName(descriptor.currentUrl, 'screenshot'),
          mimeType: 'image/png',
          base64: bytesToBase64(bytes),
          label: 'Browser screenshot',
        });
      }, 'Could not capture the page'),
    [run, workspaceId, uploadAvailable, uploadReason, deliver, readDescriptor, toast, api],
  );

  const captureBrowserPageText = useCallback(
    () =>
      run(async () => {
        if (!workspaceId) throw new Error('This chat has no workspace yet.');
        let page;
        try {
          page = await admin.browser.readPage(encodeURIComponent(workspaceId));
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409) throw error;
          toast({ message: 'The browser is not running. Start it from the Browser pane.', variant: 'info' });
          return;
        }
        deliver({
          source: 'browser',
          kind: 'text',
          name: pageCaptureName(page.url, 'text'),
          mimeType: 'text/markdown',
          text: formatPageText(page),
          label: `Page text${page.title ? ` — ${page.title.trim()}` : ''}`,
        });
      }, 'Could not read the page'),
    [run, workspaceId, admin, toast, deliver],
  );

  return useMemo(
    () => ({
      captureTerminalOutput,
      captureTerminalSelection,
      captureBrowserScreenshot,
      captureBrowserPageText,
      attachAvailable: uploadAvailable,
    }),
    [captureTerminalOutput, captureTerminalSelection, captureBrowserScreenshot, captureBrowserPageText, uploadAvailable],
  );
}
