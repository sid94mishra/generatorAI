// ────────────────────────────────────────────────────────────────
// WebhookService — incoming webhook handling (GitHub, custom)
// ────────────────────────────────────────────────────────────────

import { generateId, ValidationError } from '@generatorai/shared';
import type { WebhookRegistration } from '@generatorai/shared';
import type { IWebhookRepository } from '../domain/ports/IRepositories.js';
import type { SessionService } from './SessionService.js';
import type { TemplateRegistry } from './TemplateRegistry.js';
import type { EventBus } from '../events/EventBus.js';

export interface WebhookConfig {
  githubSecret?: string;
  enabled?: boolean;
}

export class WebhookService {
  constructor(
    private webhookRepo: IWebhookRepository,
    private sessionService: SessionService,
    private templateRegistry: TemplateRegistry,
    private eventBus: EventBus,
    private config: WebhookConfig,
  ) {}

  /** Handle incoming GitHub webhook. */
  async handleGitHub(
    headers: Record<string, string>,
    payload: unknown,
  ): Promise<void> {
    const event = headers['x-github-event'] ?? '';
    const deliveryId = headers['x-github-delivery'] ?? '';
    const signature = headers['x-hub-signature-256'] ?? '';

    // A missing x-github-delivery header means retries cannot be deduplicated,
    // so the same event could spawn the same workflow run multiple times.
    // Reject the request rather than fabricate an ID (the old fallback called
    // `generateId()` which silently made every retry a "new" delivery).
    if (!deliveryId) {
      throw new ValidationError(
        'Missing x-github-delivery header — required for idempotent webhook processing',
      );
    }

    // 1. Signature verification is performed by the route's `verifyGitHubSignature`
    // middleware (apps/server) against the RAW request body — the only correct
    // way to reproduce the HMAC GitHub signed. We deliberately do NOT re-verify
    // here: re-serializing the already-parsed `payload` via JSON.stringify can
    // reorder keys / change whitespace and would reject valid deliveries.
    void signature;

    // 2. Check for duplicate delivery
    const existing = await this.webhookRepo.getDeliveryById(deliveryId);
    if (existing) {
      await this.webhookRepo.updateDeliveryStatus(deliveryId, 'duplicate');
      return;
    }

    // 3. Log delivery
    await this.webhookRepo.logDelivery({
      id: generateId(),
      deliveryId,
      source: 'github',
      eventType: event,
      payload,
      status: 'received',
      receivedAt: new Date(),
    });

    // 4. Find matching registrations
    const registrations = await this.webhookRepo.getActiveRegistrations('github', event);

    for (const reg of registrations) {
      // 5. Check optional condition filter
      if (reg.condition && !this.evaluateCondition(reg.condition, payload)) continue;

      // 6. Create session from template
      const template = this.templateRegistry.getWorkflowTemplate(reg.templateId);
      if (!template) continue;

      const sessionParams = {
        name: `Webhook: ${event} → ${template.name}`,
        ...(reg.sessionConfig ?? {}),
        workflows: [
          {
            templateId: reg.templateId,
            variables: this.extractVariables(payload),
          },
        ],
      };

      const session = await this.sessionService.createSession(sessionParams);

      // 7. Auto-start if configured
      if (reg.autoStart) {
        await this.sessionService.startSession(session.id);
      }

      // 8. Update delivery log
      await this.webhookRepo.updateDelivery(deliveryId, {
        status: 'processed',
        sessionId: session.id,
        processedAt: new Date(),
      });
    }
  }

  /**
   * Handle custom webhook trigger.
   * `idempotencyKey` (from a caller-supplied `Idempotency-Key` header) is
   * used to dedup retries of the same logical event; if omitted, every
   * request is treated as a fresh delivery.
   */
  async handleCustom(
    trigger: string,
    payload: unknown,
    idempotencyKey?: string,
  ): Promise<void> {
    // Dedup retries against the delivery log.
    if (idempotencyKey) {
      const existing = await this.webhookRepo.getDeliveryById(idempotencyKey);
      if (existing) {
        await this.webhookRepo.updateDeliveryStatus(idempotencyKey, 'duplicate');
        return;
      }
      await this.webhookRepo.logDelivery({
        id: generateId(),
        deliveryId: idempotencyKey,
        source: 'custom',
        eventType: trigger,
        payload,
        status: 'received',
        receivedAt: new Date(),
      });
    }

    const registrations = await this.webhookRepo.getActiveRegistrations('custom', trigger);
    for (const reg of registrations) {
      const session = await this.sessionService.createSession({
        name: `Custom trigger: ${trigger}`,
        ...(reg.sessionConfig ?? {}),
        workflows: [
          {
            templateId: reg.templateId,
            variables: (payload as Record<string, unknown>) ?? {},
          },
        ],
      });
      if (reg.autoStart) {
        await this.sessionService.startSession(session.id);
      }
      if (idempotencyKey) {
        await this.webhookRepo.updateDelivery(idempotencyKey, {
          status: 'processed',
          sessionId: session.id,
          processedAt: new Date(),
        });
      }
    }
  }

  /** Get all webhook registrations. */
  async getAllRegistrations(): Promise<WebhookRegistration[]> {
    return this.webhookRepo.getAllRegistrations();
  }

  /** Create a new webhook registration. */
  async createRegistration(
    registration: WebhookRegistration,
  ): Promise<WebhookRegistration> {
    return this.webhookRepo.createRegistration(registration);
  }

  /** Delete a webhook registration. */
  async deleteRegistration(id: string): Promise<void> {
    return this.webhookRepo.deleteRegistration(id);
  }

  /** Extract contextual variables from webhook payload. */
  private extractVariables(payload: unknown): Record<string, unknown> {
    const p = payload as Record<string, unknown> | undefined;
    const repo = p?.['repository'] as Record<string, unknown> | undefined;
    const pr = p?.['pull_request'] as Record<string, unknown> | undefined;
    const sender = p?.['sender'] as Record<string, unknown> | undefined;
    const headCommit = p?.['head_commit'] as Record<string, unknown> | undefined;

    return {
      repoUrl: repo?.['clone_url'],
      branch: typeof p?.['ref'] === 'string'
        ? (p['ref'] as string).replace('refs/heads/', '')
        : undefined,
      sender: sender?.['login'],
      action: p?.['action'],
      prNumber: pr?.['number'],
      prTitle: pr?.['title'],
      commitSha: p?.['after'] ?? headCommit?.['id'],
    };
  }

  /** Evaluate a simple condition string against payload. */
  private evaluateCondition(condition: string, payload: unknown): boolean {
    try {
      const match = condition.match(/^(.+?)\s*(==|!=|contains)\s*(.+)$/);
      if (!match) return false;
      const [, pathStr, op, value] = match;
      const keys = (pathStr ?? '').split('.').map((k) => k.trim());
      // Refuse prototype-chain keys so a crafted condition like
      // `__proto__.x == y` can't walk off the payload object.
      const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
      if (keys.some((k) => DANGEROUS_KEYS.has(k))) return false;
      let actual: unknown = payload;
      for (const key of keys) {
        if (actual == null || typeof actual !== 'object') { actual = undefined; break; }
        actual = (actual as Record<string, unknown>)[key];
      }
      const cleanVal = (value ?? '').replace(/['"]/g, '');
      switch (op) {
        case '==':
          return String(actual) === cleanVal;
        case '!=':
          return String(actual) !== cleanVal;
        case 'contains':
          return String(actual).includes(cleanVal);
        default:
          return false;
      }
    } catch {
      return false;
    }
  }
}
