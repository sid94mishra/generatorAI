import { createHash } from 'node:crypto';

/** Validate the response representation, not just its underlying blob pair. */
export function changeFileEtag(result: unknown): string {
  return `"change-file-${createHash('sha256').update(JSON.stringify(result)).digest('hex')}"`;
}
