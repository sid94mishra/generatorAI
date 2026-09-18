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
import { describeErrorBody, type TerminalDescriptor } from '@generatorai/client-core';

import { bytesToBase64, utf8Decode } from '../../../lib/base64';
import { currentTerminalSelection, pickCaptureSession } from '../../../terminal/terminalFocus';
import {
  captureDestination,
  formatPageText,
  formatTerminalLines,
  fullFrameClip,
  pageCaptureName,
  plainTextFromPty,
  terminalCaptureName,
  terminalScrollbackPath,
  type CaptureInput,
  type TerminalCaptureLines,
} from './captures';
import type { ComposerCaptureActions } from './captureContext';

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

/** Throws with a one-line, human message from an error response. */
async function failure(res: Response, fallback: string): Promise<Error> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    /* body already gone */
  }
  let described: string | null = null;
  try {
    described = describeErrorBody(JSON.parse(text));
  } catch {
    described = text || null;
  }
  const line = (described ?? `${fallback} (${res.status})`).split(/\r?\n/)[0]!.trim();
  return new Error(line.length > 160 ? `${line.slice(0, 157)}…` : line);
}

export function useCaptures(opts: UseCapturesOptions): ComposerCaptureActions {
  const { workspaceId, authedFetch, uploadAvailable, uploadReason, attach, insertText, setBusy, toast, onCaptured } = opts;

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
        toast({ message: err instanceof Error && err.message ? err.message : fallback, variant: 'danger' });
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
          const res = await authedFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/terminals`);
          if (!res.ok) throw await failure(res, 'Could not list terminals');
          const body = (await res.json()) as { terminals?: TerminalDescriptor[] };
          const alive = (body.terminals ?? []).filter((d) => d.exitCode === null).map((d) => d.id);
          sid = pickCaptureSession(workspaceId, alive);
        }
        if (!sid) {
          toast({ message: 'No terminal is open in this workspace. Open one from the Terminal pane.', variant: 'info' });
          return;
        }
        let text: string;
        const res = await authedFetch(terminalScrollbackPath(workspaceId, sid, lines));
        if (res.status === 409) {
          // The host keeps no VT model: take raw bytes and de-escape them.
          const raw = await authedFetch(
            `/api/workspaces/${encodeURIComponent(workspaceId)}/terminals/${encodeURIComponent(sid)}/scrollback?tailBytes=${lines * 400}`,
          );
          if (!raw.ok) throw await failure(raw, 'Could not read the terminal');
          text = plainTextFromPty(utf8Decode(new Uint8Array(await raw.arrayBuffer())), lines).join('\n');
        } else {
          if (!res.ok) throw await failure(res, 'Could not read the terminal');
          const body = (await res.json()) as { lines?: string[] };
          text = formatTerminalLines(body.lines ?? []);
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
    [run, workspaceId, authedFetch, toast, deliver],
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

  const readDescriptor = useCallback(async () => {
    const res = await authedFetch(`/api/workspaces/${encodeURIComponent(workspaceId!)}/browser/descriptor`);
    if (!res.ok) throw await failure(res, 'Could not reach the browser');
    return (await res.json()) as { ready?: boolean; currentUrl?: string | null; viewport?: { width: number; height: number } };
  }, [authedFetch, workspaceId]);

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
        const res = await authedFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/browser/capture`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clip: fullFrameClip(descriptor.viewport) }),
        });
        if (!res.ok) throw await failure(res, 'Could not capture the page');
        const bytes = new Uint8Array(await res.arrayBuffer());
        deliver({
          source: 'browser',
          kind: 'image',
          name: pageCaptureName(descriptor.currentUrl, 'screenshot'),
          mimeType: 'image/png',
          base64: bytesToBase64(bytes),
          label: 'Browser screenshot',
        });
      }, 'Could not capture the page'),
    [run, workspaceId, uploadAvailable, uploadReason, deliver, readDescriptor, toast, authedFetch],
  );

  const captureBrowserPageText = useCallback(
    () =>
      run(async () => {
        if (!workspaceId) throw new Error('This chat has no workspace yet.');
        const res = await authedFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/browser/read-page`, {
          method: 'POST',
        });
        if (res.status === 409) {
          toast({ message: 'The browser is not running. Start it from the Browser pane.', variant: 'info' });
          return;
        }
        if (!res.ok) throw await failure(res, 'Could not read the page');
        const page = (await res.json()) as { url?: string; title?: string; snapshot?: string };
        deliver({
          source: 'browser',
          kind: 'text',
          name: pageCaptureName(page.url, 'text'),
          mimeType: 'text/markdown',
          text: formatPageText(page),
          label: `Page text${page.title ? ` — ${page.title.trim()}` : ''}`,
        });
      }, 'Could not read the page'),
    [run, workspaceId, authedFetch, toast, deliver],
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
