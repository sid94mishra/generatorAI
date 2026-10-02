// One text document from the system picker (an `.agent.md`, a SKILL.md, a prompt), read as UTF-8. expo-file-system 57
// ships `File.pickFileAsync`, so no document-picker module is added (same as the composer's file attachments).
import { File } from 'expo-file-system';

export interface PickedTextFile {
  name: string;
  size: number;
  text: string;
}

export type PickTextOutcome = { status: 'picked'; file: PickedTextFile } | { status: 'cancelled' } | { status: 'too-large'; name: string; size: number } | { status: 'error'; reason: string };

/** Picks one file; refuses (without reading) anything over `maxBytes`. */
export async function pickTextFile(maxBytes: number): Promise<PickTextOutcome> {
  try {
    const result = await File.pickFileAsync({});
    if (result.canceled) return { status: 'cancelled' };
    const file = result.result;
    if (!file) return { status: 'cancelled' };
    const name = file.name || 'file';
    let size = 0;
    try {
      size = file.size;
    } catch {
      /* not stat-able: read and measure below */
    }
    if (size > maxBytes) return { status: 'too-large', name, size };
    const text = await file.text();
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > maxBytes) return { status: 'too-large', name, size: bytes };
    return { status: 'picked', file: { name, size: bytes, text } };
  } catch (e) {
    return { status: 'error', reason: e instanceof Error ? e.message : String(e) };
  }
}
