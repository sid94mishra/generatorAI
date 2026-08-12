// ────────────────────────────────────────────────────────────────
// MockAgentHarness — test double for IAgentHarness
// ────────────────────────────────────────────────────────────────

import type { AgentEvent } from '@generatorai/shared';
import type {
  IAgentHarness,
  HarnessClientState,
  HarnessClientEvent,
  HarnessModel,
  ConversationResponse,
  ConversationMessage,
  CreateConversationParams,
  AttachmentRef,
  ConversationWarning,
  HarnessAgentInfo,
} from '../src/domain/ports/IAgentHarness.js';

export class MockAgentHarness implements IAgentHarness {
  private state: HarnessClientState = 'stopped';
  private conversations = new Map<string, {
    messages: ConversationMessage[];
    eventHandlers: Set<(event: AgentEvent) => void>;
  }>();
  private clientEventHandlers = new Set<(event: HarnessClientEvent) => void>();

  /** Records of calls made, for assertion. */
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  /** Canned responses for sendPromptAndWait. */
  private cannedResponses: ConversationResponse[] = [];
  setCannedResponses(responses: ConversationResponse[]): void {
    this.cannedResponses = [...responses];
  }

  /** Auto-idle delay (ms). 0 = immediate. */
  autoIdleDelayMs = 0;

  // ── Client Lifecycle ──

  async initialize(): Promise<void> {
    this.calls.push({ method: 'initialize', args: [] });
    this.state = 'running';
  }

  async stop(): Promise<void> {
    this.calls.push({ method: 'stop', args: [] });
    this.state = 'stopped';
  }

  async forceStop(): Promise<void> {
    this.calls.push({ method: 'forceStop', args: [] });
    this.state = 'stopped';
  }

  getClientState(): HarnessClientState {
    return this.state;
  }

  async ping(): Promise<boolean> {
    return this.state === 'running';
  }

  async shutdown(): Promise<void> {
    this.calls.push({ method: 'shutdown', args: [] });
    this.conversations.clear();
    this.state = 'stopped';
  }

  // ── Model Discovery ──

  async getModels(): Promise<HarnessModel[]> {
    return [
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
    ];
  }

  // ── Conversation Lifecycle ──

  async createConversation(params: CreateConversationParams): Promise<string> {
    this.calls.push({ method: 'createConversation', args: [params] });
    this.conversations.set(params.conversationId, {
      messages: [],
      eventHandlers: new Set(),
    });
    return params.conversationId;
  }

  async resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    this.calls.push({ method: 'resumeConversation', args: [conversationId, params] });
    if (!this.conversations.has(conversationId)) {
      this.conversations.set(conversationId, {
        messages: [],
        eventHandlers: new Set(),
      });
    }
  }

  hasLiveConversation(conversationId: string): boolean {
    return this.conversations.has(conversationId);
  }

  async listConversations(): Promise<string[]> {
    return [...this.conversations.keys()];
  }

  async getLastConversationId(): Promise<string | null> {
    const keys = [...this.conversations.keys()];
    return keys[keys.length - 1] ?? null;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.calls.push({ method: 'deleteConversation', args: [conversationId] });
    this.conversations.delete(conversationId);
  }

  async destroyConversation(conversationId: string): Promise<void> {
    this.calls.push({ method: 'destroyConversation', args: [conversationId] });
    this.conversations.delete(conversationId);
  }

  getConversationWarnings(_conversationId: string): ConversationWarning[] {
    return [];
  }

  async selectAgent(conversationId: string, agentName: string): Promise<void> {
    this.calls.push({ method: 'selectAgent', args: [conversationId, agentName] });
  }

  async listAgents(conversationId: string): Promise<HarnessAgentInfo[]> {
    const params = this.calls.find(
      (c) => c.method === 'createConversation' && (c.args[0] as CreateConversationParams).conversationId === conversationId,
    )?.args[0] as CreateConversationParams | undefined;
    return (params?.customAgents ?? []).map((a) => ({ name: a.name, description: a.description }));
  }

  // ── Messaging ──

  async sendPrompt(
    conversationId: string,
    prompt: string,
    _attachments?: AttachmentRef[],
  ): Promise<void> {
    this.calls.push({ method: 'sendPrompt', args: [conversationId, prompt] });
    const conv = this.conversations.get(conversationId);
    if (!conv) return;

    conv.messages.push({ role: 'user', content: prompt });

    // Simulate assistant response + idle
    const response = this.cannedResponses.shift() ?? { content: `Mock response to: ${prompt}` };
    conv.messages.push({ role: 'assistant', content: response.content });

    // Emit events asynchronously
    setTimeout(() => {
      for (const handler of conv.eventHandlers) {
        handler({ kind: 'copilot:response', data: { content: response.content } });
      }
      setTimeout(() => {
        for (const handler of conv.eventHandlers) {
          handler({ kind: 'copilot:idle', data: {} });
        }
      }, this.autoIdleDelayMs);
    }, this.autoIdleDelayMs);
  }

  async sendPromptAndWait(
    conversationId: string,
    prompt: string,
    _attachments?: AttachmentRef[],
    _signal?: AbortSignal,
  ): Promise<ConversationResponse> {
    this.calls.push({ method: 'sendPromptAndWait', args: [conversationId, prompt] });
    const response = this.cannedResponses.shift() ?? { content: `Mock response to: ${prompt}` };
    const conv = this.conversations.get(conversationId);
    if (conv) {
      conv.messages.push({ role: 'user', content: prompt });
      conv.messages.push({ role: 'assistant', content: response.content });
    }
    return response;
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    return this.conversations.get(conversationId)?.messages ?? [];
  }

  async abortConversation(conversationId: string): Promise<void> {
    this.calls.push({ method: 'abortConversation', args: [conversationId] });
  }

  // ── Event Subscription ──

  onConversationEvent(
    conversationId: string,
    handler: (event: AgentEvent) => void,
  ): () => void {
    const conv = this.conversations.get(conversationId);
    if (!conv) return () => {};

    conv.eventHandlers.add(handler);
    return () => {
      conv.eventHandlers.delete(handler);
    };
  }

  onClientEvent(handler: (event: HarnessClientEvent) => void): () => void {
    this.clientEventHandlers.add(handler);
    return () => {
      this.clientEventHandlers.delete(handler);
    };
  }

  // ── Test Helpers ──

  /** Simulate emitting a client event (for testing interceptors). */
  simulateClientEvent(event: HarnessClientEvent): void {
    for (const handler of this.clientEventHandlers) {
      handler(event);
    }
  }

  /** Simulate emitting a conversation event (for testing). */
  simulateConversationEvent(conversationId: string, event: AgentEvent): void {
    const conv = this.conversations.get(conversationId);
    if (conv) {
      for (const handler of conv.eventHandlers) {
        handler(event);
      }
    }
  }

  /** Get count of a specific method call. */
  getCallCount(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  /** Reset all state. */
  reset(): void {
    this.conversations.clear();
    this.clientEventHandlers.clear();
    this.calls.length = 0;
    this.cannedResponses.length = 0;
    this.state = 'stopped';
  }
}


/** @deprecated Use MockAgentHarness */
export { MockAgentHarness as MockCopilotPort };
