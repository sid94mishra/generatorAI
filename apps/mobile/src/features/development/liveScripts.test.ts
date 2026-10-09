import { describe, expect, it } from 'vitest';
import { liveReducer, liveCandidates, type LiveMap } from '@generatorai/client-core';
import { FIXTURE_KEYS, liveScript, parseLiveLink } from './liveScripts';

function play(id: Parameters<typeof liveScript>[0]): LiveMap[] {
  const start = new Date('2026-10-03T10:00:00Z');
  let map: LiveMap = {};
  return liveScript(id, start).map((step, i) => (map = liveReducer(map, step.event(new Date(start.getTime() + i * 3000)))));
}

describe('live dev scripts', () => {
  it('walks a run through running, needs you and success', () => {
    const states = play('run-needs-you').map((m) => m[FIXTURE_KEYS.run]);
    expect(states.map((s) => s?.phase)).toEqual(['running', 'running', 'needs_you', 'running', 'running', 'succeeded']);
    expect(states[1]!.segments).toEqual(['done', 'current', 'pending', 'pending']);
    expect(states[2]!.ask).toMatchObject({ kind: 'stage_approval', risky: true });
    expect(liveCandidates(play('run-needs-you')[2]!, new Set([FIXTURE_KEYS.run]))).toHaveLength(1);
  });

  it('ends a failing run as failed', () => {
    expect(play('run-fails').at(-1)![FIXTURE_KEYS.run]!.phase).toBe('failed');
  });

  it('ends a chat without inventing an outcome', () => {
    const maps = play('chat-permission');
    expect(maps[1]![FIXTURE_KEYS.chat]!.phase).toBe('needs_you');
    expect(maps.at(-1)![FIXTURE_KEYS.chat]).toBeUndefined();
  });
});

describe('parseLiveLink', () => {
  it('reads the script and step of a /live link', () => {
    expect(parseLiveLink('generatorai:///live?script=run-needs-you&step=20')).toEqual({ script: 'run-needs-you', step: '20' });
    expect(parseLiveLink('generatorai:///live')).toEqual({ script: undefined, step: undefined });
  });
  it('ignores other links', () => {
    expect(parseLiveLink('generatorai:///notify?case=approval')).toBeNull();
    expect(parseLiveLink('generatorai:///chats/live?script=x')).toBeNull();
  });
});
