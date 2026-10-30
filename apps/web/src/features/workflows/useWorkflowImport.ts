// ────────────────────────────────────────────────────────────────
// Import a workflow document (the JSON Export writes) as a new draft: the
// list's "Import JSON" and the new-workflow "Import JSON" start point. The
// server validates it and answers 422 with located issues when it is not a
// valid workflow; those come back as one readable message.
// ────────────────────────────────────────────────────────────────

import type { WorkflowDefinitionRecord } from '@generatorai/workflow-spec';
import { useImportDefinition } from '@/hooks/workflowQueries.js';
import { describeWorkflowApiError, formatWorkflowApiIssue } from '@/blocks/workflow/index.js';
import { MAX_IMPORT_BYTES } from './workflowFormat.js';

export type ImportOutcome = { ok: true; record: WorkflowDefinitionRecord } | { ok: false; error: string };

/** Reads a picked file into a document, or says why it can't be imported. */
export async function readWorkflowFile(file: File): Promise<{ ok: true; document: unknown } | { ok: false; error: string }> {
  if (!file.name.toLowerCase().endsWith('.json')) return { ok: false, error: 'Choose a .json file.' };
  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, error: `The file is too large (${(file.size / 1024 / 1024).toFixed(2)} MB); the limit is 5 MB.` };
  }
  try {
    return { ok: true, document: JSON.parse(await file.text()) as unknown };
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
}

export function useWorkflowImport() {
  const importDefinition = useImportDefinition();
  const importDocument = async (document: unknown): Promise<ImportOutcome> => {
    try {
      return { ok: true, record: await importDefinition.mutateAsync(document) };
    } catch (err) {
      const e = describeWorkflowApiError(err, 'The workflow could not be imported');
      return { ok: false, error: [e.message, ...e.issues.map(formatWorkflowApiIssue)].join('\n') };
    }
  };
  return { importDocument, pending: importDefinition.isPending };
}
