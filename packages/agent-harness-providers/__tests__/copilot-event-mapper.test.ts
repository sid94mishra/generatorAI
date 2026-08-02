// ────────────────────────────────────────────────────────────────
// Copilot provider translation tests (TEST-1)
//
// Covers the SDK→domain event mapping and the permission-kind mapping —
// the integration boundary between @github/copilot-sdk and the domain
// AgentEvent ontology, previously untested.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  mapSdkEventToAgentEvent,
  mapSdkEventsToAgentEvents,
} from '../src/providers/copilot/event-mapper.js';
import { mapPermissionKind, PERMISSION_KIND_TO_DOMAIN_TYPE } from '../src/providers/copilot/permissionMap.js';

// The mapper accepts the SDK SessionEvent shape { type, data }. We cast minimal
// fixtures since we only exercise the type→kind + payload normalization paths.
function ev(type: string, data?: unknown) {
  return { type, data } as unknown as Parameters<typeof mapSdkEventToAgentEvent>[0];
}

describe('mapSdkEventToAgentEvent (TEST-1)', () => {
  it('maps a token delta to harness.token', () => {
    const out = mapSdkEventToAgentEvent(ev('assistant.message_delta', { delta: 'hi' }));
    expect(out.kind).toBe('harness.token');
  });

  it('maps assistant.message to harness.message_complete', () => {
    const out = mapSdkEventToAgentEvent(ev('assistant.message', { content: 'done' }));
    expect(out.kind).toBe('harness.message_complete');
  });

  it('maps tool lifecycle events', () => {
    expect(mapSdkEventToAgentEvent(ev('tool.execution_start', {})).kind).toBe('harness.tool_start');
    expect(mapSdkEventToAgentEvent(ev('tool.execution_complete', {})).kind).toBe('harness.tool_complete');
  });

  it('maps session lifecycle events', () => {
    expect(mapSdkEventToAgentEvent(ev('session.idle', {})).kind).toBe('harness.idle');
    expect(mapSdkEventToAgentEvent(ev('session.error', {})).kind).toBe('harness.error');
  });

  it('falls back to harness.unknown for an unmapped SDK type', () => {
    const out = mapSdkEventToAgentEvent(ev('totally.unknown.kind', {}));
    expect(out.kind).toBe('harness.unknown');
  });

  it('tolerates null/non-object data without throwing', () => {
    expect(() => mapSdkEventToAgentEvent(ev('assistant.message', null))).not.toThrow();
    expect(() => mapSdkEventToAgentEvent(ev('assistant.message', 'string-data'))).not.toThrow();
  });

  it('batch-maps an array preserving order/length', () => {
    const out = mapSdkEventsToAgentEvents([
      ev('session.start', {}),
      ev('assistant.message_delta', { delta: 'a' }),
      ev('session.idle', {}),
    ]);
    expect(out.map((e) => e.kind)).toEqual([
      'harness.session_start',
      'harness.token',
      'harness.idle',
    ]);
  });
});

describe('mapPermissionKind (TEST-1)', () => {
  it('maps known SDK kinds to domain types', () => {
    expect(mapPermissionKind('shell')).toBe('shell_exec');
    expect(mapPermissionKind('write')).toBe('file_write');
    expect(mapPermissionKind('read')).toBe('file_read');
    expect(mapPermissionKind('url')).toBe('network');
    expect(mapPermissionKind('mcp')).toBe('other');
  });

  it('maps unknown kinds to other (defensive runtime fallback)', () => {
    expect(mapPermissionKind('does-not-exist')).toBe('other');
  });

  it('every entry in the static map resolves through the function', () => {
    for (const [kind, expected] of Object.entries(PERMISSION_KIND_TO_DOMAIN_TYPE)) {
      expect(mapPermissionKind(kind)).toBe(expected);
    }
  });
});
