/**
 * W12 — AgentHostClient: gateway-side IAgentHarness that proxies to the agent-host process.
 *
 * Drop-in replacement for MultiHarness. The composition root can switch between
 * them with a config flag (`GENERATORAI_AGENT_HOST_ENABLED=true`).
 *
 * All provider handles (CLI processes, SDK instances) stay in the host process.
 * The gateway only holds typed IPC messages and session state.
 *
 * L5: Native handles never live in the control-plane process.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  SpawnSessionRequest,
  SendTurnRequest,
  AbortSessionRequest,
  DeleteSessionRequest,
} from '@generatorai/shared';
import type {
  IAgentHarness,
  HarnessClientState,
  HarnessClientEvent,
  HarnessModel,
  CreateConversationParams,
  ConversationResponse,
  ConversationMessage,
  ConversationWarning,
  HarnessAgentInfo,
  SendPromptOptions,
  AttachmentRef,
} from '../domain/ports/IAgentHarness.js';
import type { ProviderCapabilities } from '../domain/ports/IProviderInstance.js';
import type { HostSupervisor } from '../infrastructure/HostSupervisor.js';
import type { ILogger } from '@generatorai/shared';

type EventHandler = (event: AgentEvent) => void;

/** Static capabilities for the proxied host — declared, never discovered. */
const HOST_CLIENT_CAPABILITIES: ProviderCapabilities = {
  vision: true,
  reasoning: true,
  reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  maxParallelTools: 8,
  planMode: true,
  mcpServers: true,
  skillDirectories: true,
  fullToolGating: true,
  sessionPersistence: true,
  budgetTracking: true,
};

export class AgentHostClient implements IAgentHarness {
  /* W12 */
  private clientState: HarnessClientState = 'starting';
  private readonly clientHandlers = new Set<(e: HarnessClientEvent) => void>();
  private readonly conversationHandlers = new Map<string, Set<EventHandler>>();
  private readonly conversationWarnings = new Map<string, ConversationWarning[]>();
  private readonly conversationMessages = new Map<string, ConversationMessage[]>();

  constructor(
    private readonly supervisor: HostSupervisor,
    private readonly logger: ILogger,
  ) {}

  // ── IHarnessClientLifecycle ───────────────────────────────────────────────

  async initialize(): Promise<void> {
    await this.supervisor.start();
    this.clientState = 'running';
    this.emitClientEvent({ type: 'client.started' });
    this.logger.info('[AgentHostClient] Initialized — agent host connected');
  }

  async stop(): Promise<void> {
    await this.supervisor.stop();
    this.clientState = 'stopped';
    this.emitClientEvent({ type: 'client.stopped' });
  }

  async forceStop(): Promise<void> {
    await this.stop();
  }

  getClientState(): HarnessClientState {
    return this.clientState;
  }

  async ping(): Promise<boolean> {
    try {
      const resp = await this.supervisor.send({ type: 'ping' });
      return resp.type === 'pong';
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    await this.stop();
  }

  onClientEvent(handler: (event: HarnessClientEvent) => void): () => void {
    this.clientHandlers.add(handler);
    return () => this.clientHandlers.delete(handler);
  }

  capabilities(): ProviderCapabilities {
    return HOST_CLIENT_CAPABILITIES;
  }

  // ── IHarnessModelDiscovery ────────────────────────────────────────────────

  async getModels(): Promise<HarnessModel[]> {
    // Models are resolved on the host side; for now return empty — Phase B wires this
    return [];
  }

  // ── IHarnessConversationLifecycle ─────────────────────────────────────────

  async createConversation(params: CreateConversationParams): Promise<string> {
    const sessionId = randomUUID();
    this.conversationHandlers.set(sessionId, new Set());
    this.conversationWarnings.set(sessionId, []);
    this.conversationMessages.set(sessionId, []);

    const spawnReq: Omit<SpawnSessionRequest, 'reqId'> = {
      type: 'spawn_session',
      sessionId,
      params: params as unknown as Record<string, unknown>,
    };
    const resp = await this.supervisor.send(spawnReq);

    if (resp.type === 'error') {
      // N11-fix: clean all three maps on spawn failure, not just conversationHandlers
      this.conversationHandlers.delete(sessionId);
      this.conversationWarnings.delete(sessionId);
      this.conversationMessages.delete(sessionId);
      throw new Error(`AgentHostClient.createConversation failed: ${resp.message}`);
    }

    return sessionId;
  }

  async resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    // Phase A: treat resume as create with the same id context
    if (!this.conversationHandlers.has(conversationId)) {
      await this.createConversation({ ...(params ?? {}), harnessType: params?.harnessType ?? 'claude-agent' } as CreateConversationParams);
    }
  }

  hasLiveConversation(conversationId: string): boolean {
    return this.conversationHandlers.has(conversationId);
  }

  async listConversations(): Promise<string[]> {
    return [...this.conversationHandlers.keys()];
  }

  async getLastConversationId(): Promise<string | null> {
    const ids = [...this.conversationHandlers.keys()];
    return ids[ids.length - 1] ?? null;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const deleteReq: Omit<DeleteSessionRequest, 'reqId'> = { type: 'delete_session', sessionId: conversationId };
    await this.supervisor.send(deleteReq);
    this.conversationHandlers.delete(conversationId);
    this.conversationWarnings.delete(conversationId);
    this.conversationMessages.delete(conversationId);
  }

  async destroyConversation(conversationId: string): Promise<void> {
    await this.deleteConversation(conversationId);
  }

  getConversationWarnings(conversationId: string): ConversationWarning[] {
    return this.conversationWarnings.get(conversationId) ?? [];
  }

  async selectAgent(_conversationId: string, _agentName: string): Promise<void> {
    // Phase B: forward to host
  }

  async listAgents(_conversationId: string): Promise<HarnessAgentInfo[]> {
    return [];
  }

  // ── IHarnessMessaging ─────────────────────────────────────────────────────

  async sendPrompt(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    _options?: SendPromptOptions,
  ): Promise<void> {
    const turnReq: Omit<SendTurnRequest, 'reqId'> = {
      type: 'send_turn',
      sessionId: conversationId,
      prompt,
      // AttachmentRef uses `path` as the stable identifier; the host resolves files by path
      attachments: attachments?.map((a) => ({ type: 'file', id: a.path })),
    };
    const resp = await this.supervisor.send(turnReq);
    if (resp.type === 'error') {
      throw new Error(`AgentHostClient.sendPrompt failed: ${resp.message}`);
    }
  }

  async sendPromptAndWait(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    signal?: AbortSignal,
    options?: SendPromptOptions,
  ): Promise<ConversationResponse> {
    return new Promise<ConversationResponse>((resolve, reject) => {
      let settled = false;

      // Capture the abort handler by reference so removeEventListener works cleanly in Node.js
      const abortHandler = (): void => {
        if (!settled) {
          settled = true;
          void this.abortConversation(conversationId);
          reject(new Error('Aborted'));
        }
      };
      signal?.addEventListener('abort', abortHandler);

      const cleanup = this.onConversationEvent(conversationId, (event) => {
        const kind = (event as { kind?: string }).kind ?? '';
        if (kind === 'chat.message_complete' || kind === 'harness.idle') {
          if (!settled) {
            settled = true;
            signal?.removeEventListener('abort', abortHandler);
            cleanup();
            resolve({ content: '' });
          }
        } else if (kind === 'harness.error') {
          if (!settled) {
            settled = true;
            signal?.removeEventListener('abort', abortHandler);
            cleanup();
            reject(new Error((event as { data?: { message?: string } }).data?.message ?? 'Harness error'));
          }
        } else if (kind === 'harness.cancelled') {
          if (!settled) {
            settled = true;
            signal?.removeEventListener('abort', abortHandler);
            cleanup();
            // W13: cancellation is a semantic success value, not a throw
            resolve({ content: '' });
          }
        }
      });

      // N10-fix: also remove the abort handler on sendPrompt rejection so it
      // doesn't leak and cannot fire a redundant abortConversation call later.
      this.sendPrompt(conversationId, prompt, attachments, options).catch((err: unknown) => {
        if (!settled) {
          settled = true;
          signal?.removeEventListener('abort', abortHandler);
          cleanup();
          reject(err);
        }
      });
    });
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    return this.conversationMessages.get(conversationId) ?? [];
  }

  async abortConversation(conversationId: string): Promise<void> {
    const abortReq: Omit<AbortSessionRequest, 'reqId'> = { type: 'abort_session', sessionId: conversationId };
    await this.supervisor.send(abortReq).catch((err: unknown) => {
      this.logger.warn(`[AgentHostClient] abortConversation error: ${String(err)}`);
    });
  }

  // ── IHarnessEvents ────────────────────────────────────────────────────────

  onConversationEvent(conversationId: string, handler: EventHandler): () => void {
    let handlers = this.conversationHandlers.get(conversationId);
    if (!handlers) {
      handlers = new Set();
      this.conversationHandlers.set(conversationId, handlers);
    }
    handlers.add(handler);
    return () => {
      this.conversationHandlers.get(conversationId)?.delete(handler);
    };
  }

  // ── Called by HostSupervisor when events arrive from the host process ─────

  /** Wire this up: pass as `onHostEvent` to HostSupervisor. */
  handleHostEvent(msg: { type: string; sessionId?: string; event?: AgentEvent }): void {
    if (msg.type === 'agent_event' && msg.sessionId && msg.event) {
      const handlers = this.conversationHandlers.get(msg.sessionId);
      if (handlers) {
        for (const h of handlers) {
          try {
            h(msg.event);
          } catch {
            // isolated — EVT-02
          }
        }
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private emitClientEvent(event: HarnessClientEvent): void {
    for (const h of this.clientHandlers) {
      try {
        h(event);
      } catch {
        // isolated
      }
    }
  }
}
