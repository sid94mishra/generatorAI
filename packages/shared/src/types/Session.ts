// ────────────────────────────────────────────────────────────────
// Session — Domain entity (thin harness conversation wrapper)
// ────────────────────────────────────────────────────────────────

/** Session status values (6 states) */
export type SessionStatus = 'created' | 'active' | 'paused' | 'closing' | 'closed' | 'error';

/** Session owner type — who allocated this session */
export type SessionOwnerType = 'chat' | 'stage_run' | 'workflow_run';

export interface Session {
  id: string;
  name: string;
  description?: string;
  status: SessionStatus;
  model?: string;
  tags: string[];
  /** Harness conversation ID */
  conversationId?: string;
  /** Who owns this session */
  ownerType?: SessionOwnerType;
  /** FK to the owning Chat or StageRun record */
  ownerId?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  /** When the session was closed (harness conversation destroyed) */
  closedAt?: Date;
}

import type { Workflow } from './Workflow.js';

export interface SessionWithWorkflows extends Session {
  workflows: Workflow[];
}
