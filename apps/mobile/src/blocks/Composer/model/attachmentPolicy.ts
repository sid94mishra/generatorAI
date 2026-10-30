// ────────────────────────────────────────────────────────────────
// Attachment policy — what the composer accepts, and why it refuses.
//
// The numbers come from the server, not from taste: `multer` on
// `POST /api/chats/:id/prompt` is configured with `fileSize: 10 MB` and
// `files: 5` (apps/server/src/routes/chats.ts). A file the server would
// reject is refused here with a reason, instead of being uploaded and
// bounced — on a phone that upload may be on a metered link.
//
// Images are capped lower (8 MB). Neither `expo-image-manipulator` nor any
// other resizer is in the bundle (product constraint: minimal native
// modules), so the only client-side reduction available is the picker's own
// JPEG re-encode (`quality` on `expo-image-picker`). A photo that is still
// over the cap after that is refused with a suggestion rather than sent and
// rejected.
// ────────────────────────────────────────────────────────────────

import type { ComposerAttachment, ComposerAttachmentKind } from './types';

/** Server multer `fileSize`. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Images are re-encoded by the picker but never resized; keep headroom. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Server multer `files`. The client-core comment says 10; the server says 5. */
export const MAX_ATTACHMENTS = 5;
/** `expo-image-picker` `quality` — the one lever we have on photo size. */
export const IMAGE_PICKER_QUALITY = 0.8;

const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|heic|heif|bmp|svg\+xml)$/i;

const EXTENSION_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  ts: 'text/plain',
  tsx: 'text/plain',
  js: 'text/javascript',
  py: 'text/x-python',
  log: 'text/plain',
  zip: 'application/zip',
};

/** Best-effort MIME from a file name when the platform reports none. */
export function guessMimeType(name: string, reported?: string | null): string {
  if (reported && reported !== 'application/octet-stream' && reported.includes('/')) {
    return reported;
  }
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return EXTENSION_MIME[ext] ?? reported ?? 'application/octet-stream';
}

export function isImageMime(mime: string): boolean {
  return IMAGE_MIME.test(mime);
}

export function attachmentKindFor(mime: string): ComposerAttachmentKind {
  return isImageMime(mime) ? 'image' : 'file';
}

/** "3.2 MB" — for chips and refusal messages. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type AttachmentVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Whether `candidate` may join `existing`.
 *
 * Order matters: the count check comes first because it is the one the user
 * can do nothing about by picking a different file.
 */
export function validateAttachment(
  candidate: Pick<ComposerAttachment, 'name' | 'mimeType' | 'size'>,
  existing: ReadonlyArray<Pick<ComposerAttachment, 'name' | 'size'>>,
): AttachmentVerdict {
  if (existing.length >= MAX_ATTACHMENTS) {
    return {
      ok: false,
      reason: `Up to ${MAX_ATTACHMENTS} attachments per message. Remove one to add another.`,
    };
  }
  const image = isImageMime(candidate.mimeType);
  const cap = image ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
  if (candidate.size > cap) {
    return {
      ok: false,
      reason: image
        ? `${candidate.name} is ${formatBytes(candidate.size)}. Images must be under ${formatBytes(cap)} — try a screenshot or a smaller export.`
        : `${candidate.name} is ${formatBytes(candidate.size)}. Files must be under ${formatBytes(cap)}.`,
    };
  }
  if (existing.some((e) => e.name === candidate.name && e.size === candidate.size)) {
    return { ok: false, reason: `${candidate.name} is already attached.` };
  }
  return { ok: true };
}

/** Byte length of a base64 payload without decoding it. */
export function base64ByteLength(base64: string): number {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  if (clean.length === 0) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

/** Split a `data:` URI into its MIME type and base64 body. */
export function parseDataUri(uri: string): { mimeType: string; base64: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(uri);
  if (!m) return null;
  return { mimeType: m[1]!, base64: m[2]! };
}

/** `pasted-1717000000000.png` — the name the web composer gives a pasted image. */
export function pastedImageName(mimeType: string, now = Date.now()): string {
  const ext = (mimeType.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
  return `pasted-${now}.${ext}`;
}

/**
 * Base64 → bytes without `atob` (not guaranteed on Hermes) and without
 * `Buffer` (not in the RN bundle).
 */
export function decodeBase64(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)]!;
    const b = lookup[clean.charCodeAt(i + 1)]!;
    const c = i + 2 < clean.length ? lookup[clean.charCodeAt(i + 2)]! : 0;
    const d = i + 3 < clean.length ? lookup[clean.charCodeAt(i + 3)]! : 0;
    out[o++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < clean.length) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}
