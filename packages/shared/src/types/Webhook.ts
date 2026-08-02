// ────────────────────────────────────────────────────────────────
// Webhook types — registration + delivery
// ────────────────────────────────────────────────────────────────

import type { CreateSessionParams } from './CreateSessionParams.js';

export interface WebhookRegistration {
  id: string;
  name: string;
  source: string;
  eventType: string;
  condition?: string;
  templateId: string;
  autoStart: boolean;
  sessionConfig?: Partial<CreateSessionParams>;
  enabled: boolean;
  createdAt: Date;
  lastTriggeredAt?: Date;
}

export interface WebhookDelivery {
  id: string;
  registrationId?: string;
  deliveryId?: string;
  source: string;
  eventType: string;
  payload?: unknown;
  status: 'received' | 'processed' | 'failed' | 'duplicate';
  error?: string;
  sessionId?: string;
  receivedAt: Date;
  processedAt?: Date;
}
