// Event classification (W04) — the split every other Phase 1 item depends on.
//
// The interesting assertions here are not "token is a delta". They are the
// guards that stop the table decaying: that it stays exhaustive over the union,
// that items are never reclassified as droppable by accident, and that an
// unrecognised kind fails safe.

import { describe, expect, it } from 'vitest';

import type { AgentEvent } from '../src/types/AgentEvent.js';
import {
  DELTA_SESSION_INFO_TYPES,
  EVENT_CLASS,
  classifyEvent,
  isDeltaEvent,
} from '../src/types/eventClass.js';

describe('classifyEvent', () => {
  it('classifies streamed text and reasoning as deltas', () => {
    expect(classifyEvent('harness.token')).toBe('delta');
    expect(classifyEvent('harness.reasoning_delta')).toBe('delta');
  });

  it('classifies the completed forms of those same things as items', () => {
    // The pair matters: a delta may be dropped, and the item is what makes that
    // survivable. Reclassifying `message_complete` would make token loss
    // permanent and undetectable.
    expect(classifyEvent('harness.message_complete')).toBe('item');
    expect(classifyEvent('harness.reasoning_complete')).toBe('item');
  });

  it('classifies chunked output and progress ticks as deltas', () => {
    expect(classifyEvent('script.stdout')).toBe('delta');
    expect(classifyEvent('script.stderr')).toBe('delta');
    expect(classifyEvent('git.clone_progress')).toBe('delta');
    expect(classifyEvent('automation_execution.progress')).toBe('delta');
  });

  it('keeps usage an item even though it looks like a stream', () => {
    // Each usage record carries a distinct cost figure that nothing supersedes,
    // so the "a later one makes this worthless" test fails.
    expect(classifyEvent('harness.usage')).toBe('item');
    expect(classifyEvent('harness.context_usage')).toBe('item');
  });

  it('never classifies a lifecycle transition as droppable', () => {
    const lifecycle = Object.keys(EVENT_CLASS).filter(
      (k) =>
        k.startsWith('workflow_run.') ||
        k.startsWith('stage_run.') ||
        k.startsWith('session.') ||
        k.startsWith('permission.') ||
        k.startsWith('chat.'),
    );
    expect(lifecycle.length).toBeGreaterThan(50);
    for (const kind of lifecycle) {
      expect(classifyEvent(kind), `${kind} must not be droppable`).toBe('item');
    }
  });

  it('classifies the artifact and audit trail as items', () => {
    // Losing one of these breaks the record of what the agent did, which is
    // exactly what a user asks for after something went wrong.
    for (const kind of ['artifact.created', 'artifact.available', 'computer.action', 'computer.refusal']) {
      expect(classifyEvent(kind)).toBe('item');
    }
  });

  describe('harness.session_info — payload discriminated', () => {
    it('is a delta for the per-chunk tool carriers', () => {
      for (const infoType of DELTA_SESSION_INFO_TYPES) {
        expect(classifyEvent('harness.session_info', { infoType })).toBe('delta');
      }
    });

    it('is an item for everything a surface actually renders', () => {
      // These broke plan mode and subagent progress the last time the whole
      // KIND was filtered. They must never become droppable.
      for (const infoType of [
        'subagent_started',
        'subagent_completed',
        'subagent_failed',
        'abort',
        'unresolved_variables',
      ]) {
        expect(classifyEvent('harness.session_info', { infoType })).toBe('item');
      }
    });

    it('is an item with no payload, a malformed payload, or an unknown infoType', () => {
      expect(classifyEvent('harness.session_info')).toBe('item');
      expect(classifyEvent('harness.session_info', null)).toBe('item');
      expect(classifyEvent('harness.session_info', 'nonsense')).toBe('item');
      expect(classifyEvent('harness.session_info', { infoType: 42 })).toBe('item');
      expect(classifyEvent('harness.session_info', { infoType: 'brand_new' })).toBe('item');
    });
  });

  it('fails safe on an unmapped kind', () => {
    // Cannot come from `AgentEvent` — the table is exhaustive over that union —
    // so it is a raw passthrough from an unmapped provider. Guessing
    // "droppable" for something unrecognised loses the one event that explained
    // a failure.
    expect(classifyEvent('provider.brand_new_thing')).toBe('item');
    expect(classifyEvent('')).toBe('item');
  });

  it('agrees with isDeltaEvent', () => {
    expect(isDeltaEvent('harness.token')).toBe(true);
    expect(isDeltaEvent('harness.message_complete')).toBe(false);
    expect(isDeltaEvent('harness.session_info', { infoType: 'tool_progress' })).toBe(true);
    expect(isDeltaEvent('harness.session_info', { infoType: 'abort' })).toBe(false);
  });
});

describe('EVENT_CLASS table', () => {
  it('is exhaustive over the AgentEvent union', () => {
    // `Record<AgentEvent['kind'], EventClass>` already makes this a compile
    // error, so this asserts the type is doing its job rather than duplicating
    // it — if someone widens the key type to `string`, tsc goes quiet and this
    // catches it.
    const key: AgentEvent['kind'] = 'harness.token';
    expect(EVENT_CLASS[key]).toBeDefined();
    expect(Object.keys(EVENT_CLASS).length).toBeGreaterThanOrEqual(159);
  });

  it('holds only the two valid classes', () => {
    for (const [kind, cls] of Object.entries(EVENT_CLASS)) {
      expect(['delta', 'item'], `${kind} has an invalid class`).toContain(cls);
    }
  });

  it('keeps deltas a small minority — they are the exception', () => {
    const deltas = Object.values(EVENT_CLASS).filter((c) => c === 'delta').length;
    // A table where most things are droppable has stopped meaning anything.
    expect(deltas).toBeGreaterThan(0);
    expect(deltas).toBeLessThan(Object.keys(EVENT_CLASS).length * 0.15);
  });
});
