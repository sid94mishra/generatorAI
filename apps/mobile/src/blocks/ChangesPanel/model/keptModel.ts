// ────────────────────────────────────────────────────────────────
// Keep / review state for the Changes list — the desktop Changes tab's model.
//
// "Keep" marks a file reviewed AT ITS CURRENT CONTENT (the server stores the
// head blob the client saw). A kept file leaves the to-review list for a
// collapsed "Kept" group; if the agent edits it again the blob no longer
// matches and it returns to review on its own, so a Keep can never hide work
// nobody looked at. Pure, so the split is tested without a renderer.
// ────────────────────────────────────────────────────────────────

export interface KeepableFile {
  alias: string;
  path: string;
  status: string;
  newBlob?: string | undefined;
  kept?: boolean | undefined;
}

export interface KeptSplit<T> {
  pending: T[];
  kept: T[];
}

/** Still to review vs already kept, order preserved. */
export function splitKept<T extends KeepableFile>(files: readonly T[]): KeptSplit<T> {
  const pending: T[] = [];
  const kept: T[] = [];
  for (const file of files) (file.kept === true ? kept : pending).push(file);
  return { pending, kept };
}

/**
 * The `keep` entry for one file. `blob` is the head blob the client saw — the
 * empty string for a deleted file, whose "current content" is its absence.
 */
export function keepRef(file: KeepableFile): { alias: string; path: string; blob: string } {
  return { alias: file.alias, path: file.path, blob: file.status === 'deleted' ? '' : (file.newBlob ?? '') };
}

/** "3 kept" / "1 kept" — the label on the group toggle. */
export function keptLabel(count: number): string {
  return `${count} kept`;
}

/** What Undo all is about to throw away, for its confirmation. */
export function undoAllMessage(pendingCount: number, keptCount: number): string {
  const total = pendingCount + keptCount;
  const files = `${total} ${total === 1 ? 'file' : 'files'}`;
  return `Every change in ${files} is reverted to where this comparison started${
    keptCount > 0 ? ', including the ones you kept' : ''
  }. A snapshot is saved first, so it can be restored from Checkpoints.`;
}
