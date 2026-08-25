// W44 — FauxProvider tests
import { describe, it, expect, beforeEach } from 'vitest';
import { FauxProvider } from '../src/providers/faux/FauxProvider.js';
import type { AgentEvent } from '@generatorai/shared';
import {
  runConversationLifecycleConformance,
  runToolCallConformance,
  runCancellationConformance,
  runTruncationConformance,
  runCapabilityDeclarationConformance,
} from '../src/conformance/index.js';

describe('FauxProvider — W44', () => {
  let faux: FauxProvider;
  const convId = 'test-conv-1';

  beforeEach(async () => {
    faux = new FauxProvider();
    await faux.initialize();
    await faux.createConversation({ conversationId: convId });
  });

  // ── Basic lifecycle ──────────────────────────────────────────

  it('initialize sets state to running', () => {
    expect(faux.getClientState()).toBe('running');
  });

  it('ping returns true when running', async () => {
    expect(await faux.ping()).toBe(true);
  });

  it('stop sets state to stopped', async () => {
    await faux.stop();
    expect(faux.getClientState()).toBe('stopped');
  });

  it('hasLiveConversation true after create, false after delete', async () => {
    expect(faux.hasLiveConversation(convId)).toBe(true);
    await faux.deleteConversation(convId);
    expect(faux.hasLiveConversation(convId)).toBe(false);
  });

  // ── Scripted text response ───────────────────────────────────

  it('emits harness.token events for text entries', async () => {
    const events: AgentEvent[] = [];
    faux.onConversationEvent(convId, (e) => events.push(e));

    faux.script([
      { type: 'text', content: 'Hello world' },
      { type: 'complete' },
    ], convId);

    const result = await faux.sendPromptAndWait(convId, 'hi');

    const tokens = events
      .filter((e): e is Extract<AgentEvent, { kind: 'harness.token' }> => e.kind === 'harness.token')
      .map((e) => e.data.text)
      .join('');

    expect(tokens.trim()).toBe('Hello world');
    expect(result.content.trim()).toBe('Hello world');
    expect(events.map((e) => e.kind)).toContain('harness.message_complete');
    expect(events.map((e) => e.kind)).toContain('harness.idle');
  });

  // ── Two-turn tool loop ───────────────────────────────────────

  it('pauses at tool_call entry and resumes after provideToolResult', async () => {
    const events: AgentEvent[] = [];
    faux.onConversationEvent(convId, (e) => events.push(e));

    faux.script([
      { type: 'text', content: 'Let me check.' },
      { type: 'tool_call', name: 'Read', input: { file_path: '/x' }, callId: 'call-42' },
      { type: 'text', content: 'Got it.' },
      { type: 'complete' },
    ], convId);

    const turnPromise = faux.sendPromptAndWait(convId, 'read /x');

    // Wait for tool_start to be emitted
    await new Promise((r) => setTimeout(r, 20));
    expect(events.some((e) => e.kind === 'harness.tool_start')).toBe(true);
    expect(faux.hasPendingToolCall()).toBe(true);

    // Provide result
    await faux.provideToolResult('call-42', 'file data');

    const result = await turnPromise;
    expect(result.content).toContain('Got it');

    const toolComplete = events.find(
      (e): e is Extract<AgentEvent, { kind: 'harness.tool_complete' }> => e.kind === 'harness.tool_complete',
    );
    expect(toolComplete).toBeDefined();
    expect(toolComplete?.data.result).toBe('file data');
    expect(toolComplete?.data.success).toBe(true);
  });

  // ── Semantic cancellation (W13/X-4) ─────────────────────────

  it('emits harness.cancelled and does NOT throw on scripted cancellation', async () => {
    const events: AgentEvent[] = [];
    faux.onConversationEvent(convId, (e) => events.push(e));

    faux.script([{ type: 'cancelled', reason: 'user_abort' }], convId);

    let threw = false;
    try {
      await faux.sendPromptAndWait(convId, 'do something');
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(events.some((e) => e.kind === 'harness.cancelled')).toBe(true);
    expect(events.some((e) => e.kind === 'harness.error')).toBe(false);
  });

  it('abortConversation emits harness.cancelled', async () => {
    const events: AgentEvent[] = [];
    faux.onConversationEvent(convId, (e) => events.push(e));

    faux.script([
      { type: 'tool_call', name: 'Bash', input: { command: 'sleep 10' } },
    ], convId);

    const turnPromise = faux.sendPromptAndWait(convId, 'sleep');

    await new Promise((r) => setTimeout(r, 10));
    await faux.abortConversation(convId);
    await turnPromise;

    expect(events.some((e) => e.kind === 'harness.cancelled')).toBe(true);
  });

  // ── Truncation guard (W13/B1) ────────────────────────────────

  it('scripted truncation emits tool_complete with success:false for all pending tool calls', async () => {
    const events: AgentEvent[] = [];
    faux.onConversationEvent(convId, (e) => events.push(e));

    faux.script([
      { type: 'tool_call', name: 'Write', input: { file_path: '/danger', content: 'X' } },
      { type: 'truncated' },
    ], convId);

    await faux.sendPromptAndWait(convId, 'write');

    const completeEvents = events.filter(
      (e): e is Extract<AgentEvent, { kind: 'harness.tool_complete' }> =>
        e.kind === 'harness.tool_complete',
    );
    expect(completeEvents.length).toBeGreaterThan(0);
    expect(completeEvents.every((e) => e.data.success === false)).toBe(true);
    const errorMsg = String(completeEvents[0]?.data.result ?? '');
    expect(errorMsg).toMatch(/truncated|length/i);
  });

  // ── Exhaustion (in-band, not throw) ─────────────────────────

  it('scripted exhaustion delivers in-band error event, not throw', async () => {
    const events: AgentEvent[] = [];
    faux.onConversationEvent(convId, (e) => events.push(e));

    faux.script([{ type: 'exhausted', maxTurns: 5 }], convId);

    let threw = false;
    try {
      await faux.sendPromptAndWait(convId, 'go');
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    const errorEvt = events.find(
      (e): e is Extract<AgentEvent, { kind: 'harness.error' }> => e.kind === 'harness.error',
    );
    expect(errorEvt).toBeDefined();
    expect(errorEvt?.data.message).toMatch(/max turns|5/i);
  });

  // ── Usage events ─────────────────────────────────────────────

  it('emits harness.usage when complete includes usage', async () => {
    const events: AgentEvent[] = [];
    faux.onConversationEvent(convId, (e) => events.push(e));

    faux.script([
      { type: 'text', content: 'Done' },
      { type: 'complete', usage: { inputTokens: 100, outputTokens: 50, cost: 0.01 } },
    ], convId);

    await faux.sendPromptAndWait(convId, 'hi');

    const usageEvt = events.find(
      (e): e is Extract<AgentEvent, { kind: 'harness.usage' }> => e.kind === 'harness.usage',
    );
    expect(usageEvt).toBeDefined();
    expect(usageEvt?.data.inputTokens).toBe(100);
    expect(usageEvt?.data.outputTokens).toBe(50);
  });

  // ── Capabilities ─────────────────────────────────────────────

  it('capabilities() returns a complete struct with fail-closed defaults', () => {
    const caps = faux.capabilities();
    expect(caps.vision).toBe(false);
    expect(caps.reasoning).toBe(false);
    expect(Array.isArray(caps.reasoningEfforts)).toBe(true);
    expect(caps.fullToolGating).toBe(true);
    expect(caps.sessionPersistence).toBe(false);
  });

  it('capabilities() can be overridden via constructor', () => {
    const customFaux = new FauxProvider({ capabilities: { vision: true, reasoning: true } });
    expect(customFaux.capabilities().vision).toBe(true);
    expect(customFaux.capabilities().reasoning).toBe(true);
    // Other fields still have defaults
    expect(customFaux.capabilities().planMode).toBe(false);
  });

  // ── Conformance suites ───────────────────────────────────────

  it('passes conversation lifecycle conformance', async () => {
    await expect(runConversationLifecycleConformance(faux)).resolves.not.toThrow();
  });

  it('passes tool call conformance', async () => {
    await expect(runToolCallConformance(faux)).resolves.not.toThrow();
  });

  it('passes cancellation conformance', async () => {
    await expect(runCancellationConformance(faux)).resolves.not.toThrow();
  });

  it('passes truncation conformance', async () => {
    await expect(runTruncationConformance(faux)).resolves.not.toThrow();
  });

  it('passes capability declaration conformance', () => {
    expect(() => runCapabilityDeclarationConformance(faux)).not.toThrow();
  });
});
