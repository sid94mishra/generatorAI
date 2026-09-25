// ────────────────────────────────────────────────────────────────
// workflowExport — file name for a downloaded workflow document
// (`GET /workflow-definitions/:id/export`, the canonical format that
// Upload JSON imports).
// ────────────────────────────────────────────────────────────────

/** A file-name-safe slug of the workflow name. */
export function exportFileName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'workflow'}.workflow.json`;
}
