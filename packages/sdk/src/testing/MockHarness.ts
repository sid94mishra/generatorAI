// ────────────────────────────────────────────────────────────────
// MockHarness — Fake AI provider for testing
// ────────────────────────────────────────────────────────────────

import type { HarnessClientState, HarnessModel } from '@generatorai/core';

/**
 * A mock harness that returns canned responses.
 * Useful for unit testing without needing a real AI provider.
 */
export class MockHarness {
  private _initialized = false;

  async initialize(): Promise<void> {
    this._initialized = true;
  }

  async stop(): Promise<void> {
    this._initialized = false;
  }

  async forceStop(): Promise<void> {
    this._initialized = false;
  }

  async ping(): Promise<boolean> {
    return this._initialized;
  }

  async getModels(): Promise<HarnessModel[]> {
    return [{ id: 'mock-model', name: 'Mock Model', provider: 'mock' }];
  }

  getClientState(): HarnessClientState {
    return this._initialized ? 'running' : 'stopped';
  }

  // ── Conversation lifecycle (no-op stubs) ──
  async createConversation(params: { conversationId?: string }): Promise<string> {
    return params?.conversationId ?? `mock-conv-${this._convSeq++}`;
  }
  async resumeConversation(): Promise<void> {}
  async listConversations(): Promise<string[]> {
    return [];
  }
  async getLastConversationId(): Promise<string | null> {
    return null;
  }
  async deleteConversation(): Promise<void> {}
  async destroyConversation(): Promise<void> {}

  // ── Prompting ──
  async sendPrompt(): Promise<void> {}
  async sendPromptAndWait(): Promise<{ content: string }> {
    return { content: 'mock response' };
  }
  async getMessages(): Promise<unknown[]> {
    return [];
  }
  async abortConversation(): Promise<void> {}

  // ── Event subscriptions (return no-op unsubscribers) ──
  onConversationEvent(): () => void {
    return () => {};
  }
  onClientEvent(): () => void {
    return () => {};
  }

  async shutdown(): Promise<void> {
    this._initialized = false;
  }

  private _convSeq = 1;
}
