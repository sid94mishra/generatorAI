// ────────────────────────────────────────────────────────────────
// Captures — terminal output and browser pages, handed to the composer.
//
// Web's panels hand the composer a `File` (`onCapture`) that rides the next
// message as an attachment (ChatPage `pendingCaptures`):
//   terminal   `terminal-selection-<ts>.txt`, text/plain
//   browser    `capture-<ts>.png` (region screenshot) or an element summary
//              as text/markdown
// Mobile produces the same shapes as `ComposerAttachment{kind:'capture'}` so
// they travel through the one attachment path (policy → chips → multipart).
//
// When this device may not upload (`write:files` withheld), a TEXT capture
// can still reach the agent as part of the prompt itself: it is inserted
// into the draft as a fenced block. A screenshot has no text form and is
// refused with the reason.
//
// Pure — no React Native — so the formatting rules are unit-tested.
// ────────────────────────────────────────────────────────────────

import type { ComposerAttachment } from './types';

export type CaptureSource = 'terminal' | 'browser';

/** A capture before it becomes an attachment or draft text. */
export type CaptureInput =
  | {
      source: CaptureSource;
      kind: 'text';
      /** File name the attachment carries — `terminal-output-<ts>.txt`. */
      name: string;
      mimeType: 'text/plain' | 'text/markdown';
      text: string;
      /** Short human label for the draft fence header and toasts. */
      label: string;
    }
  | {
      source: CaptureSource;
      kind: 'image';
      name: string;
      mimeType: 'image/png' | 'image/jpeg';
      base64: string;
      label: string;
    };

/** The two tails the terminal capture sheet offers. */
export const TERMINAL_CAPTURE_LINES = [50, 200] as const;
export type TerminalCaptureLines = (typeof TERMINAL_CAPTURE_LINES)[number];

/**
 * Largest text capture inserted into the draft when attachments are not
 * permitted. A draft is a TextInput, not a file: past this it becomes
 * unusable to edit on a phone, and the tail is what matters in a log.
 */
export const MAX_DRAFT_CAPTURE_CHARS = 20_000;

/**
 * Rendered terminal lines → one text block.
 *
 * The host's VT model pads the screen: trailing blank rows below the prompt
 * and trailing spaces on every row. Both are noise to an agent.
 */
export function formatTerminalLines(lines: readonly string[]): string {
  const trimmed = lines.map((l) => l.replace(/\s+$/u, ''));
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === '') end -= 1;
  let start = 0;
  while (start < end && trimmed[start] === '') start += 1;
  return trimmed.slice(start, end).join('\n');
}

/** `terminal-output-1717000000000.txt` / `terminal-selection-…` — web's naming. */
export function terminalCaptureName(kind: 'output' | 'selection', now = Date.now()): string {
  return `terminal-${kind}-${now}.txt`;
}

/** `/api/workspaces/:id/terminals/:sid/scrollback?format=text&tailLines=N` */
export function terminalScrollbackPath(workspaceId: string, sessionId: string, tailLines: number): string {
  const n = Math.max(1, Math.min(5_000, Math.floor(tailLines)));
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/terminals/${encodeURIComponent(sessionId)}/scrollback?format=text&tailLines=${n}`;
}

/**
 * The clip for a whole-viewport `POST /browser/capture`. The route only
 * takes a region (web's drag-to-capture); the full frame is the region
 * that covers the viewport. Falls back to a common desktop size when the
 * descriptor has not reported one yet.
 */
export function fullFrameClip(viewport: { width?: number; height?: number } | null | undefined): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const width = viewport?.width && viewport.width > 0 ? Math.round(viewport.width) : 1280;
  const height = viewport?.height && viewport.height > 0 ? Math.round(viewport.height) : 800;
  return { x: 0, y: 0, width, height };
}

/** `POST /browser/read-page` → a markdown document the agent can read as-is. */
export function formatPageText(page: { url?: string | null; title?: string | null; snapshot?: string | null }): string {
  const lines: string[] = [];
  lines.push(`# ${page.title?.trim() || 'Untitled page'}`);
  if (page.url) lines.push('', `URL: ${page.url}`);
  lines.push('', '## Page structure (accessibility tree)', '', '```', (page.snapshot ?? '').trimEnd(), '```', '');
  return lines.join('\n');
}

/** `page-<host>-<ts>.md` — the host keeps two captures of different sites apart. */
export function pageCaptureName(url: string | null | undefined, kind: 'text' | 'screenshot', now = Date.now()): string {
  let host = 'page';
  const m = url ? /^[a-z]+:\/\/([^/:?#]+)/i.exec(url) : null;
  if (m?.[1]) host = m[1].replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'page';
  return kind === 'text' ? `page-${host}-${now}.md` : `capture-${host}-${now}.png`;
}

/** UTF-8 byte length without TextEncoder (not guaranteed everywhere). */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

let seq = 0;

/** A capture as a composer attachment chip. */
export function captureToAttachment(input: CaptureInput, now = Date.now()): ComposerAttachment {
  seq += 1;
  const id = `capture:${input.source}:${now}:${seq}`;
  if (input.kind === 'text') {
    return {
      id,
      kind: 'capture',
      name: input.name,
      uri: '',
      mimeType: input.mimeType,
      size: utf8ByteLength(input.text),
      text: input.text,
    };
  }
  const uri = `data:${input.mimeType};base64,${input.base64}`;
  const clean = input.base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return {
    id,
    kind: 'capture',
    name: input.name,
    uri,
    mimeType: input.mimeType,
    size: Math.max(0, Math.floor((clean.length * 3) / 4) - padding),
    previewUri: uri,
  };
}

/**
 * Insert a text capture into the draft — the fallback when attachments are
 * not permitted. Appended after what the user already typed, as a fenced
 * block with a longer fence than any run of backticks inside it, so terminal
 * output containing ``` cannot close the block early.
 */
export function insertCaptureIntoDraft(
  draft: string,
  capture: { label: string; text: string },
): { text: string; caret: number; truncated: boolean } {
  let body = capture.text;
  let truncated = false;
  if (body.length > MAX_DRAFT_CAPTURE_CHARS) {
    body = body.slice(body.length - MAX_DRAFT_CAPTURE_CHARS);
    const nl = body.indexOf('\n');
    if (nl >= 0 && nl < 200) body = body.slice(nl + 1);
    truncated = true;
  }
  let longest = 0;
  for (const run of body.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const header = truncated ? `${capture.label} (last part):` : `${capture.label}:`;
  const block = `${header}\n${fence}\n${body}\n${fence}\n`;
  const lead = draft.length === 0 ? '' : draft.endsWith('\n\n') ? '' : draft.endsWith('\n') ? '\n' : '\n\n';
  const text = `${draft}${lead}${block}`;
  return { text, caret: text.length, truncated };
}

/**
 * Where a capture should go given what this device may do.
 *   attach   — the upload scope is held
 *   draft    — no upload scope, but the capture is text
 *   refuse   — no upload scope and nothing textual to insert
 */
export function captureDestination(input: Pick<CaptureInput, 'kind'>, uploadAvailable: boolean): 'attach' | 'draft' | 'refuse' {
  if (uploadAvailable) return 'attach';
  return input.kind === 'text' ? 'draft' : 'refuse';
}

const ESC = '\\x1b';
const OSC_RE = new RegExp(`${ESC}\\][\\s\\S]*?(?:\\x07|${ESC}\\\\)`, 'g');
const CSI_RE = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');
const SHORT_ESC_RE = new RegExp(`${ESC}(?:[()#][0-9A-Za-z]|[@-Z\\\\^_=>78])`, 'g');
const C0_RE = /[\x00-\x08\x0b-\x1f\x7f]/g;

/**
 * Raw PTY bytes → readable lines, for hosts with no VT model (the scrollback
 * route 409s `?format=text` there). Strips OSC / CSI / short escape
 * sequences, resolves carriage-return overwrites to the last write on the
 * line, and keeps the last `tailLines`. Not a terminal emulator — cursor
 * movement inside a full-screen app is lost — but a build log reads fine.
 */
export function plainTextFromPty(raw: string, tailLines: number): string[] {
  const noEscapes = raw.replace(OSC_RE, '').replace(CSI_RE, '').replace(SHORT_ESC_RE, '').replace(/\r\n/g, '\n');
  const lines = noEscapes.split('\n').map((line) => {
    const trimmedEnd = line.replace(/\r+$/, '');
    const cr = trimmedEnd.lastIndexOf('\r');
    const visible = cr >= 0 ? trimmedEnd.slice(cr + 1) : trimmedEnd;
    return visible.replace(C0_RE, '');
  });
  const formatted = formatTerminalLines(lines);
  if (!formatted) return [];
  const all = formatted.split('\n');
  const n = Math.max(1, Math.floor(tailLines));
  return all.length > n ? all.slice(all.length - n) : all;
}
