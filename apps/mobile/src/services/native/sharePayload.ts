// The shared content as the `/share` sheet sees it (MX-09; MD-190) — pure, so the mapping from expo-share-intent's
// parsed intent is tested without a device.
import type { ShareIntent } from 'expo-share-intent';

export interface SharedFile {
  name: string;
  mimeType: string;
  /** Bytes, when the OS reported them. */
  size: number | null;
  /** `file://` (iOS App Group copy, Android cache copy). */
  uri: string;
}

export interface SharePayload {
  text?: string;
  url?: string;
  files: SharedFile[];
  /** When it arrived (a newer share replaces it). */
  at: number;
}

/** Whether a deep link is the share extension's hand-off (`<scheme>://dataUrl=<key>…`). */
export function isShareHandoff(url: string | null | undefined): boolean {
  return typeof url === 'string' && /^[a-z][a-z0-9+.-]*:\/\/\/?dataUrl=/i.test(url);
}

function fileUri(path: string): string {
  return path.startsWith('/') ? `file://${path}` : path;
}

/** The module's parsed intent → what the sheet shows and sends. Null when it carries nothing. */
export function toSharePayload(intent: ShareIntent, at: number): SharePayload | null {
  const files: SharedFile[] = (intent.files ?? [])
    .filter((f) => Boolean(f.path))
    .map((f) => ({ name: f.fileName || 'Shared file', mimeType: f.mimeType || 'application/octet-stream', size: typeof f.size === 'number' ? f.size : null, uri: fileUri(f.path) }));
  const url = intent.webUrl ?? undefined;
  // A shared link arrives as its text too: keep the text only when it says more than the link.
  const text = intent.text && intent.text.trim() !== url ? intent.text : undefined;
  if (!text && !url && files.length === 0) return null;
  return { ...(text ? { text } : {}), ...(url ? { url } : {}), files, at };
}
