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
  /**
   * The PROVIDER's own session handle for `conversationId` — Claude's SDK
   * session id, Codex's thread id. Persisted after every turn so a fork or
   * rewind after a server restart still has something to branch from.
   */
  providerSessionId?: string;
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
