// ────────────────────────────────────────────────────────────────
// HarnessProxy — Mutable IAgentHarness wrapper that enables runtime
// provider switching. All services hold a reference to this proxy;
// calling switchAdapter() swaps the underlying provider transparently.
//
// W33 — Architecture note:
//   HarnessProxy is the LIVE production shim used by MultiHarness to fan out
//   conversations to the correct provider adapter at runtime. It is NOT a
//   testing utility or CLI-only helper — every production conversation goes
//   through this wrapper. Use it anywhere an IAgentHarness reference is stored
//   and you want the underlying provider to be hot-swappable without requiring
//   callers to re-subscribe.
//
//   For testing, use FauxProvider (packages/agent-harness-providers/src/providers/faux/)
//   or the conformance suite (packages/agent-harness-providers/src/conformance/).
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
  ConversationWarning,
  HarnessAgentInfo,
  ProviderCapabilities,
  HarnessRuntimeDiagnostics,
  ForkConversationOptions,
  ForkConversationResult,
  RewindConversationOptions,
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
  /**
   * Optional on the port, so it is forwarded only when the wrapped adapter
   * actually has it. Returning `undefined` for a provider that cannot warm is
   * what lets the caller skip it without a capability check.
   */
  prewarmConversation(conversationId: string, turnOptions?: SendPromptOptions): Promise<void> {
    return this._adapter.prewarmConversation?.(conversationId, turnOptions) ?? Promise.resolve();
  }
  hasLiveConversation(conversationId: string): boolean {
    return this._adapter.hasLiveConversation(conversationId);
  }
  getProviderSessionId(conversationId: string): string | undefined {
    return this._adapter.getProviderSessionId?.(conversationId);
  }
  /**
   * Optional on the port: forwarded only when the wrapped adapter implements
   * it, so a caller that checks `capabilities().conversationFork` first never
   * reaches a missing method.
   */
  forkConversation(conversationId: string, options: ForkConversationOptions): Promise<ForkConversationResult> {
    const fn = this._adapter.forkConversation;
    if (!fn) return Promise.reject(new Error('This provider cannot fork conversations'));
    return fn.call(this._adapter, conversationId, options);
  }
  rewindConversation(conversationId: string, options: RewindConversationOptions): Promise<ForkConversationResult> {
    const fn = this._adapter.rewindConversation;
    if (!fn) return Promise.reject(new Error('This provider cannot rewind conversations'));
    return fn.call(this._adapter, conversationId, options);
  }
  capabilitiesFor(conversationId: string): ProviderCapabilities {
    return this._adapter.capabilitiesFor?.(conversationId) ?? this._adapter.capabilities();
  }
  runtimeDiagnostics(): HarnessRuntimeDiagnostics {
    return this._adapter.runtimeDiagnostics?.() ?? { liveConversations: 0, liveSessions: 0, warmSessions: 0 };
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
  getConversationWarnings(conversationId: string): ConversationWarning[] {
    return this._adapter.getConversationWarnings(conversationId);
  }
  selectAgent(conversationId: string, agentName: string): Promise<void> {
    return this._adapter.selectAgent(conversationId, agentName);
  }
  listAgents(conversationId: string): Promise<HarnessAgentInfo[]> {
    return this._adapter.listAgents(conversationId);
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
  // W42 / N-2 — delegate capability declarations to the underlying adapter.
  capabilities(): ProviderCapabilities {
    return this._adapter.capabilities();
  }
}
