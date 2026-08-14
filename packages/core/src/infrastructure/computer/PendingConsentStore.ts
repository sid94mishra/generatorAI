// ────────────────────────────────────────────────────────────────
// PendingConsentStore — IComputerConsentStore over a grant repository plus
// a live prompt round-trip.
//
// `prompt()` emits `computer.consent_required` and parks on a promise until
// the desktop shell POSTs the answer to /internal/computer/consent, which
// calls `resolve()`.
//
// The default answer is DENY, in every direction: an unanswered prompt, a
// duplicate answer, a shutdown mid-prompt, or an unparsable decision all end
// as a denial. A consent gate whose failure mode is "allow" is not a gate.
// ────────────────────────────────────────────────────────────────

import type { AgentEvent, ComputerConsentDecision, ILogger } from '@generatorai/shared';
import type {
  ComputerConsentPrompt,
  ComputerConsentScope,
  ComputerStoredGrant,
  IComputerConsentStore,
} from '../../services/ComputerService.js';
import type { EventBus } from '../../events/EventBus.js';

export interface IComputerGrantRepository {
  findGrant(workspaceId: string, appIdentity: string): Promise<ComputerStoredGrant | null>;
  saveGrant(
    workspaceId: string,
    appIdentity: string,
    appLabel: string,
    decision: 'always_allow' | 'deny',
    scope: ComputerConsentScope,
  ): Promise<void>;
}

interface Pending {
  resolve: (decision: ComputerConsentDecision) => void;
  workspaceId: string;
  appIdentity: string;
  expiresAt: number;
  /** Tier 3 prompts may never be answered `always_allow`. */
  synthetic: boolean;
  /** Kept so a UI that connects mid-prompt can render it without the event. */
  prompt: ComputerConsentPrompt;
}

/** A prompt still awaiting an answer, for a client that missed the event. */
export interface PendingConsentSummary {
  requestId: string;
  appIdentity: string;
  appLabel: string;
  action: string;
  summary: string;
  path: 'synthetic' | 'accessibility';
  expiresAt: number;
}

export interface PendingConsentStoreOptions {
  eventBusScopeSessionId?: string;
  /**
   * Answer every prompt `allow_once` without asking a human.
   *
   * Development ONLY, and refused outright when NODE_ENV is production. It
   * exists because the consent UI is not built yet, so in a browser-only setup
   * nothing can answer a prompt and every action expires into a denial — which
   * makes the feature impossible to exercise end to end. Mirrors the existing
   * `security.allowUnauthenticatedLoopback` escape hatch: narrow, explicit,
   * loudly logged, and inert in production.
   */
  autoApproveForDevelopment?: boolean;
}

export class PendingConsentStore implements IComputerConsentStore {
  private readonly pending = new Map<string, Pending>();
  private readonly scope: string;
  private readonly autoApprove: boolean;

  constructor(
    private readonly repository: IComputerGrantRepository,
    private readonly eventBus: EventBus,
    private readonly logger: ILogger,
    options: PendingConsentStoreOptions = {},
  ) {
    this.scope = options.eventBusScopeSessionId ?? 'computer';
    this.autoApprove =
      options.autoApproveForDevelopment === true && process.env['NODE_ENV'] !== 'production';
    if (this.autoApprove) {
      this.logger.warn?.(
        '[PendingConsentStore] AUTO-APPROVING every computer-use consent prompt. Development only — the agent can drive any non-blocklisted application without asking.',
      );
    }
  }

  async find(workspaceId: string, appIdentity: string): Promise<ComputerStoredGrant | null> {
    return this.repository.findGrant(workspaceId, appIdentity);
  }

  async save(
    workspaceId: string,
    appIdentity: string,
    appLabel: string,
    decision: 'always_allow' | 'deny',
    scope: ComputerConsentScope,
  ): Promise<void> {
    await this.repository.saveGrant(workspaceId, appIdentity, appLabel, decision, scope);
  }

  async prompt(request: ComputerConsentPrompt): Promise<ComputerConsentDecision> {
    // The service races its own deadline and abandons this promise on timeout;
    // without a sweep the entry would live forever and a late answer would
    // report success to a UI whose prompt nobody is waiting on.
    this.sweepExpired();

    if (this.autoApprove) {
      // Still emitted, so the transcript and the event stream show exactly what
      // would have been asked. Never `always_allow`: a dev shortcut must not
      // write a durable grant that outlives the dev session.
      await this.emitPrompt(request).catch(() => undefined);
      this.logger.warn?.(
        `[PendingConsentStore] auto-approved ${request.action} on ${request.app.name} (development)`,
      );
      return 'allow_once';
    }

    const answered = new Promise<ComputerConsentDecision>((resolve) => {
      this.pending.set(request.requestId, {
        resolve,
        workspaceId: request.workspaceId,
        appIdentity: request.app.appId,
        expiresAt: request.expiresAt,
        synthetic: request.scope === 'synthetic',
        prompt: request,
      });
    });

    const event: AgentEvent = {
      kind: 'computer.consent_required',
      data: {
        workspaceId: request.workspaceId,
        chatId: request.chatId,
        requestId: request.requestId,
        appIdentity: request.app.appId,
        appLabel: request.app.name,
        action: request.action,
        summary: request.summary,
        path: request.scope === 'synthetic' ? 'synthetic' : 'accessibility',
        expiresAt: request.expiresAt,
      },
    };

    try {
      await this.eventBus.emit(`${this.scope}:${request.workspaceId}`, event);
    } catch (err) {
      // Nobody can see the prompt, so nobody can approve it. Failing closed
      // here is what stops a broken event pipeline reading as approval.
      this.pending.delete(request.requestId);
      this.logger.warn?.(`[PendingConsentStore] could not deliver consent prompt: ${(err as Error).message}`);
      return 'deny';
    }

    return answered;
  }

  private async emitPrompt(request: ComputerConsentPrompt): Promise<void> {
    await this.eventBus.emit(`${this.scope}:${request.workspaceId}`, {
      kind: 'computer.consent_required',
      data: {
        workspaceId: request.workspaceId,
        chatId: request.chatId,
        requestId: request.requestId,
        appIdentity: request.app.appId,
        appLabel: request.app.name,
        action: request.action,
        summary: request.summary,
        path: request.scope === 'synthetic' ? 'synthetic' : 'accessibility',
        expiresAt: request.expiresAt,
      },
    });
  }

  /**
   * Prompts still awaiting an answer for a workspace.
   *
   * The event is emitted once, the instant the agent asks. A panel that opens
   * in response to that same event subscribes too late to receive it, so
   * without this the user is shown a surface that knows nothing is waiting
   * while the agent sits blocked behind it.
   */
  listPending(workspaceId: string): PendingConsentSummary[] {
    this.sweepExpired();
    const out: PendingConsentSummary[] = [];
    for (const [requestId, entry] of this.pending) {
      if (entry.workspaceId !== workspaceId) continue;
      out.push({
        requestId,
        appIdentity: entry.prompt.app.appId,
        appLabel: entry.prompt.app.name,
        action: entry.prompt.action,
        summary: entry.prompt.summary,
        path: entry.synthetic ? 'synthetic' : 'accessibility',
        expiresAt: entry.expiresAt,
      });
    }
    return out;
  }

  /**
   * Called by the loopback route when the desktop shell answers.
   *
   * @returns false when nothing was waiting — a replay, an expired prompt, or
   * an answer naming an application other than the one being asked about.
   */
  resolve(requestId: string, decision: ComputerConsentDecision, appIdentity: string): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    if (entry.appIdentity !== appIdentity) {
      this.logger.warn?.(
        `[PendingConsentStore] consent answer for ${requestId} named the wrong application; ignoring`,
      );
      return false;
    }
    if (entry.expiresAt <= Date.now()) {
      this.pending.delete(requestId);
      entry.resolve('deny');
      return false;
    }
    this.pending.delete(requestId);
    // Downgraded rather than rejected: a UI that offers "always allow" on a
    // Tier 3 prompt is a bug, but the user did mean to approve this one action.
    const effective = entry.synthetic && decision === 'always_allow' ? 'allow_once' : decision;
    entry.resolve(effective);
    return true;
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [requestId, entry] of this.pending) {
      if (entry.expiresAt > now) continue;
      this.pending.delete(requestId);
      entry.resolve('deny');
    }
  }

  /** Denies every outstanding prompt. Called on shutdown and session teardown. */
  cancelAll(workspaceId?: string): void {
    for (const [requestId, entry] of this.pending) {
      if (workspaceId && entry.workspaceId !== workspaceId) continue;
      this.pending.delete(requestId);
      entry.resolve('deny');
    }
  }
}
