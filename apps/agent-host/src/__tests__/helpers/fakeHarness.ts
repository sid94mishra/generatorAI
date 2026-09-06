/**
 * Minimal in-memory IAgentHarness for agent-host tests.
 *
 * Only the methods the host actually calls are real; everything else throws so
 * a test that starts depending on an unimplemented path fails loudly instead of
 * silently exercising a stub.
 */

import type { AgentEvent, ILogger } from '@generatorai/shared';
import type { IAgentHarness } from '@generatorai/core';

type Handler = (event: AgentEvent) => void;

export class FakeHarness {
  readonly conversations = new Set<string>();
  /** Every params object `createConversation` was called with, in order. */
  readonly createParams: Array<Record<string, unknown>> = [];
  readonly prompts: Array<{ conversationId: string; prompt: string }> = [];
  readonly aborted: string[] = [];
  readonly deleted: string[] = [];
  stopped = false;
  /** Set to make createConversation reject. */
  failCreate: Error | undefined;
  /** Resolves createConversation only when this is settled (cold-start gating tests). */
  createGate: (() => Promise<void>) | undefined;
  createStarted = 0;

  private readonly handlers = new Map<string, Set<Handler>>();
  private nextId = 1;

  constructor(readonly name = 'fake') {}

  async initialize(): Promise<void> {}
  readonly selectedAgents = new Map<string, string>();
  async getModels(): Promise<Array<{ id: string; name: string; provider?: string }>> {
    return [{ id: 'fake-1', name: 'Fake One', provider: this.name }];
  }
  async selectAgent(conversationId: string, agentName: string): Promise<void> {
    this.selectedAgents.set(conversationId, agentName);
  }
  async listAgents(conversationId: string): Promise<Array<{ name: string; description?: string }>> {
    const selected = this.selectedAgents.get(conversationId);
    return [{ name: 'default' }, ...(selected ? [{ name: selected, description: 'selected' }] : [])];
  }
  async stop(): Promise<void> {
    this.stopped = true;
  }

  async createConversation(params?: Record<string, unknown>): Promise<string> {
    this.createStarted++;
    this.createParams.push(params ?? {});
    if (this.createGate) await this.createGate();
    if (this.failCreate) throw this.failCreate;
    const id = `${this.name}-conv-${this.nextId++}`;
    this.conversations.add(id);
    return id;
  }

  /**
   * Stands in for a provider's own session id (Claude's `sdkSessionId`, the
   * thing `options.resume` needs). A recycle has to carry this onto the
   * replacement runtime or the conversation restarts with no history.
   */
  getProviderSessionId(conversationId: string): string | undefined {
    return this.conversations.has(conversationId) ? `sdk-${conversationId}` : undefined;
  }

  async sendPrompt(conversationId: string, prompt: string): Promise<void> {
    this.prompts.push({ conversationId, prompt });
  }

  async abortConversation(conversationId: string): Promise<void> {
    this.aborted.push(conversationId);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.deleted.push(conversationId);
    this.conversations.delete(conversationId);
  }

  onConversationEvent(conversationId: string, handler: Handler): () => void {
    let set = this.handlers.get(conversationId);
    if (!set) {
      set = new Set();
      this.handlers.set(conversationId, set);
    }
    set.add(handler);
    return () => {
      this.handlers.get(conversationId)?.delete(handler);
    };
  }

  /** Number of live subscribers — used to assert subscriptions are not leaked. */
  subscriberCount(conversationId: string): number {
    return this.handlers.get(conversationId)?.size ?? 0;
  }

  /** Drive an event into every subscriber for a conversation. */
  emit(conversationId: string, event: AgentEvent): void {
    for (const h of [...(this.handlers.get(conversationId) ?? [])]) h(event);
  }

  asHarness(): IAgentHarness {
    return this as unknown as IAgentHarness;
  }
}

export function tokenEvent(text: string): AgentEvent {
  return { kind: 'harness.token', data: { text }, timestamp: new Date().toISOString() } as AgentEvent;
}

export function idleEvent(): AgentEvent {
  return { kind: 'harness.idle', data: {}, timestamp: new Date().toISOString() } as AgentEvent;
}

export function silentLogger(): ILogger {
  const noop = (): void => {};
  return { debug: noop, info: noop, warn: noop, error: noop } as unknown as ILogger;
}

/** Collects log lines so a test can assert something was reported, not swallowed. */
export function recordingLogger(): ILogger & { lines: string[] } {
  const lines: string[] = [];
  const push = (level: string) => (msg: string) => {
    lines.push(`${level}: ${msg}`);
  };
  return {
    lines,
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
  } as unknown as ILogger & { lines: string[] };
}
