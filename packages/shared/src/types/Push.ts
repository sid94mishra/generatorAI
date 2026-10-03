import type { GateRisk } from '../security/gateRisk.js';
import type { AttentionEntity } from './Attention.js';

/** Push envelope. v2 routes pin the server and use the same paths as attention; `category` is a shared NotificationCategoryId. */
export interface PushData {
  route: string;
  category: string;
  threadId: string;
  chatId?: string;
  interactionId?: string;
  kind?: 'permission' | 'question' | 'plan';
  actions?: readonly string[];
  v?: 2;
  serverId?: string;
  href?: string;
  entity?: AttentionEntity;
  entityId?: string;
  workflowDefinitionId?: string;
  /** MG-04 — a risky gate opens the app instead of offering lock-screen answers. */
  risk?: GateRisk;
  // ── MG-06 part B (M9-02) ──
  /** Workflow run gates and outcomes. */
  runId?: string;
  stageRunId?: string;
  /** A chat question: the first question, so a lock-screen reply can be matched to an option (MD-183). */
  question?: PushQuestion;
  /** Lock-screen-safe copy (MD-33): the iOS service extension swaps it in while previews are hidden. */
  redacted?: { title: string; body: string };
  /** The sending server's attention counts at send time (badge, quick-action subtitle). */
  counts?: { needsYou: number; running: number };
}

export interface PushQuestion {
  /** The question's id (the `answers` key of `POST …/respond`). */
  id: string;
  /** Option labels, at most four (shared NOTIFICATION_MAX_OPTIONS). */
  options: string[];
  multiSelect: boolean;
  /** A free-text answer is accepted. */
  freeText: boolean;
  /** How many questions the gate asks; only a single question can be answered from the notification. */
  count: number;
}
