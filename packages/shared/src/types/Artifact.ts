// ────────────────────────────────────────────────────────────────
// Artifact — Domain value object
// ────────────────────────────────────────────────────────────────

export interface Artifact {
  id: string;
  sessionId: string;
  /** v2: Associated workflow run */
  workflowRunId?: string;
  /** v2: Associated stage run */
  stageRunId?: string;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  direction: 'inbound' | 'outbound';
  createdAt: Date;
}
