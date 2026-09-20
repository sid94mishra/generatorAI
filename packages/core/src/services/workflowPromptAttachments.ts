import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AttachmentRef } from '../domain/ports/IAgentHarness.js';

/** Deliver uploaded prompts through the provider-neutral attachment contract.
 * `promptDirectories` is not a harness option; passing it in session config
 * alone silently drops the files for providers such as Codex.
 */
export async function workflowPromptAttachments(directories: unknown): Promise<AttachmentRef[]> {
  const attachments: AttachmentRef[] = [];
  const seen = new Set<string>();
  for (const directory of Array.isArray(directories) ? directories : []) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) continue;
    try {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        // Uploaded prompts are flat files. Never follow links or recursively
        // expose unrelated configuration directories to the provider.
        if (!entry.isFile()) continue;
        const filePath = path.join(directory, entry.name);
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        attachments.push({ type: 'file', path: filePath, displayName: entry.name });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return attachments;
}
