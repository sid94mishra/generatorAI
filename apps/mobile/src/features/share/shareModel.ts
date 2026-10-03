// The share sheet's rules (MX-09, MShortcuts; 06 §7.7, MD-190) — pure: how a shared file is described, what stops
// Send (the ingest limits, MG-09), and the request's target.
import { CHAT_INGEST_MAX_FILE_BYTES, CHAT_INGEST_MAX_FILES, CHAT_INGEST_MAX_TEXT, type ChatIngestTarget } from '@generatorai/shared';

import type { SharePayload } from '../../services/native/sharePayload';
import type { MobileIconConcept } from '@generatorai/design-tokens';

export type ShareMode = 'existing' | 'new';

/** "Plain text", "Image", "PDF", … — the board's type word. */
export function fileKind(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.startsWith('image/')) return 'Image';
  if (m === 'application/pdf') return 'PDF';
  if (m === 'application/json' || m.endsWith('+json')) return 'JSON';
  if (m === 'text/plain') return 'Plain text';
  if (m.startsWith('text/')) return 'Text';
  if (m.startsWith('video/')) return 'Video';
  if (m === 'application/zip' || m.endsWith('zip')) return 'Archive';
  return 'File';
}

export function fileIcon(mimeType: string): MobileIconConcept {
  return mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('text/') ? 'file-text' : 'file';
}

/** "48 KB", "1.2 MB", "120 B". */
export function formatSize(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Why Send is not possible, shown before it is pressed; null when it can go. */
export function shareProblem(payload: SharePayload | null): string | null {
  if (!payload) return 'Nothing to share.';
  if (payload.files.length > CHAT_INGEST_MAX_FILES) return `Up to ${CHAT_INGEST_MAX_FILES} files can be sent at once.`;
  const big = payload.files.find((f) => f.size !== null && f.size > CHAT_INGEST_MAX_FILE_BYTES);
  if (big) return `${big.name} is larger than ${CHAT_INGEST_MAX_FILE_BYTES / (1024 * 1024)} MB.`;
  if ((payload.text?.length ?? 0) > CHAT_INGEST_MAX_TEXT) return 'The shared text is too long to send.';
  return null;
}

/** The request target; null while an existing chat is still to be picked. */
export function shareTarget(mode: ShareMode, chatId: string | null, spec: { agentRef?: string | null; projectId?: string | null }): ChatIngestTarget | null {
  if (mode === 'existing') return chatId ? { chatId } : null;
  return {
    newChat: {
      ...(spec.agentRef ? { agentRef: spec.agentRef } : {}),
      ...(spec.projectId ? { projectId: spec.projectId } : {}),
    },
  };
}

/** The first line of shared text, for its preview row. */
export function textPreview(text: string): string {
  const line = text.split('\n').find((l) => l.trim())?.trim() ?? '';
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}
