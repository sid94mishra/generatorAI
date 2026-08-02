// ────────────────────────────────────────────────────────────────
// HarnessProxy — Mutable IAgentHarness wrapper that enables runtime
// provider switching. All services hold a reference to this proxy;
// calling switchAdapter() swaps the underlying provider transparently.
// ────────────────────────────────────────────────────────────────

import type {
  IAgentHarness,
  HarnessClientState,
  HarnessClientEvent,
  HarnessModel,
  ConversationResponse,
  ConversationMessage,
  CreateConversationParams,
  AttachmentRef,
  SendPromptOptions,
} from '@generatorai/core';
import type { AgentEvent } from '@generatorai/shared';
import type { HarnessType } from './types.js';

/**
 * The proxy's type label. Built-in providers use the {@link HarnessType} union;
 * a bring-your-own `IAgentHarness` instance uses an arbitrary label (e.g.
 * `'custom'` or a vendor name). `(string & {})` preserves literal autocomplete
 * for the known values while still accepting any string.
 */
export type HarnessTypeLabel = HarnessType | (string & {});

export class HarnessProxy implements IAgentHarness {
  private _adapter: IAgentHarness;
  private _type: HarnessTypeLabel;

  constructor(adapter: IAgentHarness, type: HarnessTypeLabel) {
    this._adapter = adapter;
    this._type = type;
  }

  /** Current harness type label ('copilot' | 'claude-agent' | custom). */
  get harnessType(): HarnessTypeLabel {
    return this._type;
  }

  /** The underlying adapter (for direct access if needed). */
  get adapter(): IAgentHarness {
    return this._adapter;
  }

  /**
   * Hot-swap the underlying adapter. Shuts down the old adapter,
   * replaces it, and initializes the new one.
   */
  async switchAdapter(newAdapter: IAgentHarness, newType: HarnessTypeLabel): Promise<void> {
    // Best-effort shutdown of the old adapter
    try {
      await this._adapter.shutdown();
    } catch {
      // old adapter may already be stopped — that's fine
    }
    this._adapter = newAdapter;
    this._type = newType;
    await this._adapter.initialize();
  }

  // ── Delegate all IAgentHarness methods ──

  initialize(): Promise<void> {
    return this._adapter.initialize();
  }
  stop(): Promise<void> {
    return this._adapter.stop();
  }
  forceStop(): Promise<void> {
    return this._adapter.forceStop();
  }
  getClientState(): HarnessClientState {
    return this._adapter.getClientState();
  }
  ping(): Promise<boolean> {
    return this._adapter.ping();
  }
  shutdown(): Promise<void> {
    return this._adapter.shutdown();
  }
  getModels(): Promise<HarnessModel[]> {
    return this._adapter.getModels();
  }
  createConversation(params: CreateConversationParams): Promise<string> {
    return this._adapter.createConversation(params);
  }
  resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    return this._adapter.resumeConversation(conversationId, params);
  }
  hasLiveConversation(conversationId: string): boolean {
    return this._adapter.hasLiveConversation(conversationId);
  }
  listConversations(): Promise<string[]> {
    return this._adapter.listConversations();
  }
  getLastConversationId(): Promise<string | null> {
    return this._adapter.getLastConversationId();
  }
  deleteConversation(conversationId: string): Promise<void> {
    return this._adapter.deleteConversation(conversationId);
  }
  destroyConversation(conversationId: string): Promise<void> {
    return this._adapter.destroyConversation(conversationId);
  }
  sendPrompt(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    options?: SendPromptOptions,
  ): Promise<void> {
    return this._adapter.sendPrompt(conversationId, prompt, attachments, options);
  }
  sendPromptAndWait(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    signal?: AbortSignal,
    options?: SendPromptOptions,
  ): Promise<ConversationResponse> {
    return this._adapter.sendPromptAndWait(conversationId, prompt, attachments, signal, options);
  }
  getMessages(conversationId: string): Promise<ConversationMessage[]> {
    return this._adapter.getMessages(conversationId);
  }
  abortConversation(conversationId: string): Promise<void> {
    return this._adapter.abortConversation(conversationId);
  }
  onConversationEvent(
    conversationId: string,
    handler: (event: AgentEvent) => void,
  ): () => void {
    return this._adapter.onConversationEvent(conversationId, handler);
  }
  onClientEvent(handler: (event: HarnessClientEvent) => void): () => void {
    return this._adapter.onClientEvent(handler);
  }
}
