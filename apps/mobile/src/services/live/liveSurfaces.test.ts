import { describe, expect, it } from 'vitest';
import { FOLLOW_TTL_MS, liveReducer, type LiveMap } from '@generatorai/client-core';
import type { AttentionItem } from '@generatorai/shared';
import { followedLiveKeys, parseFollowMap, runOutcome, surfaceCandidates } from './liveSurfaces';

const now = Date.parse('2026-10-03T10:00:00Z');
const base = { title: 't', state: 'running' as const, since: new Date(now).toISOString(), stoppable: true };
const items: AttentionItem[] = [
  { ...base, key: 'chat:c1', entity: 'chat', entityId: 'c1', href: '/chats/c1' },
  { ...base, key: 'chat:c2:i', entity: 'chat', entityId: 'c2', href: '/chats/c2/gate/i', state: 'needs_you', ask: { kind: 'question', id: 'i', summary: 'Which?', actions: ['answer'] } },
  { ...base, key: 'workflow_run:r1', entity: 'workflow_run', entityId: 'r1', href: '/workflows/w/runs/r1' },
];
const map: LiveMap = liveReducer({}, { type: 'attention', items, server: { id: 's', name: 'S' }, now: new Date(now) });
const all = new Set(['s:chat:c1', 's:chat:c2', 's:workflow_run:r1']);

describe('live surfaces', () => {
  it('gives chats a surface only while they need you, and honours the two switches', () => {
    expect(surfaceCandidates(map, all, { runs: true, chats: true }).map((s) => s.entityId)).toEqual(['c2', 'r1']);
    expect(surfaceCandidates(map, all, { runs: false, chats: true }).map((s) => s.entityId)).toEqual(['c2']);
    expect(surfaceCandidates(map, all, { runs: true, chats: false }).map((s) => s.entityId)).toEqual(['r1']);
  });

  it('parses the follow map, dropping expired and malformed entries', () => {
    const raw = JSON.stringify({ 'chat:c1': now - 1000, 'chat:old': now - FOLLOW_TTL_MS, 'bad id': now, 'chat:x': 'no' });
    const follows = parseFollowMap(raw, now);
    expect(follows).toEqual({ 'chat:c1': now - 1000 });
    expect([...followedLiveKeys('s', follows)]).toEqual(['s:chat:c1']);
    expect(parseFollowMap('{', now)).toEqual({});
  });

  it('maps a finished run status to its outcome only', () => {
    expect(['completed', 'failed', 'cancelled', 'finalizing', undefined].map(runOutcome)).toEqual(['succeeded', 'failed', 'cancelled', null, null]);
  });
});
