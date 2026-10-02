import type { GateRisk } from '../security/gateRisk.js';
import type { AttentionEntity } from './Attention.js';

/** Push envelope. v2 routes pin the server and use the same paths as attention. */
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
}
