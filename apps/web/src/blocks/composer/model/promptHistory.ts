// ────────────────────────────────────────────────────────────────
// promptHistory — ↑ / ↓ in the composer walks the prompts already sent.
//
// Shell semantics: ↑ on the first line of the box recalls the previous
// prompt (and its attachments), ↓ on the last line moves forward again; past
// the newest entry the draft the user was typing comes back. Editing the
// recalled text leaves history mode, so a tweaked prompt is a new prompt.
//
// Entries come from two places, merged here: the persisted user messages the
// page already has (survive reload), and prompts sent in this session that
// the server has not echoed back yet (so ↑ works the instant Send lands).
// ────────────────────────────────────────────────────────────────

export interface HistoryAttachment {
  name: string;
  mimeType: string;
  /** Fetchable URL for a persisted attachment. */
  url?: string;
  /** The in-memory file for a prompt sent this session. */
  file?: File;
}

export interface PromptHistoryEntry {
  id: string;
  text: string;
  /** Epoch ms — orders the merge. */
  ts: number;
  attachments: HistoryAttachment[];
}

/**
 * Persisted entries win; a locally recorded send is dropped once a persisted
 * entry with the same text arrives at or after it. Result is oldest → newest.
 */
export function mergePromptHistory(
  persisted: readonly PromptHistoryEntry[],
  local: readonly PromptHistoryEntry[],
): PromptHistoryEntry[] {
  const out = persisted.slice();
  for (const l of local) {
    const echoed = persisted.some((p) => p.text === l.text && p.ts >= l.ts - 5_000);
    if (!echoed) out.push(l);
  }
  out.sort((a, b) => a.ts - b.ts);
  // Collapse immediate repeats so ↑ does not step through the same prompt
  // three times when the user re-sent it.
  return out.filter((e, i) => i === 0 || out[i - 1]!.text !== e.text || out[i - 1]!.attachments.length !== e.attachments.length);
}

/** Is the caret on the first / last line of the textarea value? */
export function caretLine(value: string, caret: number): { first: boolean; last: boolean } {
  return {
    first: value.lastIndexOf('\n', caret - 1) === -1,
    last: value.indexOf('\n', caret) === -1,
  };
}

/**
 * Next history index for a keypress. `idx === null` means "not browsing"
 * (the draft is showing). Returns the same shape back; `null` result index
 * means "show the draft again". `undefined` means the key should fall
 * through to the textarea (nothing to do).
 */
export function stepHistory(
  idx: number | null,
  length: number,
  dir: -1 | 1,
): number | null | undefined {
  if (length === 0) return undefined;
  if (dir === -1) {
    if (idx === null) return length - 1;
    if (idx === 0) return undefined;
    return idx - 1;
  }
  if (idx === null) return undefined;
  return idx + 1 >= length ? null : idx + 1;
}

/** Turn a history attachment back into a composer `File`. */
export async function materializeAttachment(att: HistoryAttachment): Promise<File> {
  if (att.file) return att.file;
  if (!att.url) throw new Error(`No source for attachment ${att.name}`);
  const res = await fetch(att.url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Could not fetch ${att.name} (${res.status})`);
  const blob = await res.blob();
  return new File([blob], att.name, { type: att.mimeType || blob.type });
}
