import { describe, expect, it } from 'vitest';
import { liveReducer, type LiveMap } from '@generatorai/client-core';
import type { AttentionItem } from '@generatorai/shared';

import type { WidgetPalette } from '../native/widgetPalette';
import { hexToArgb, liveLines, liveNotificationId, planLiveSurfaces, toAndroidLiveUpdate, toLiveActivityProps } from './liveSurfaceModel';

const now = new Date('2026-10-03T10:00:00Z');
const server = { id: 's', name: 'S' };
const palette: WidgetPalette = {
  appearance: 'dark', ground: 'g', surface: 'su', raised: 'ra', line: 'li', fg: 'f1', fg2: 'f2', fg3: 'f3',
  accent: 'ac', onAccent: 'oa', run: 'RUN', ok: 'OK', warn: 'WARN', err: 'ERR',
};
const hexPalette: WidgetPalette = {
  ...palette, line: '#2d3644', run: '#59c2ff', ok: '#7fd962', warn: '#ffb454cc', err: '#f26d78',
};
const run: AttentionItem = {
  key: 'workflow_run:r1', entity: 'workflow_run', entityId: 'r1', title: 'Nightly audit', href: '/workflows/w/runs/r1',
  state: 'running', since: now.toISOString(), stoppable: true, progress: { label: 'Apply upgrades', step: 3, of: 6 },
};
const ask: AttentionItem = {
  ...run, key: 'workflow_run:r1:s3', state: 'needs_you', href: '/workflows/w/runs/r1/stages/s3/approval',
  ask: { kind: 'tool_permission', id: 'p1', summary: 'Allow Bash: rm -rf build?', actions: ['allow_once', 'deny'] },
};
const chat: AttentionItem = {
  key: 'chat:c1', entity: 'chat', entityId: 'c1', title: 'Fix flaky test', href: '/chats/c1', state: 'running',
  since: now.toISOString(), stoppable: true, progress: { label: 'Running pnpm test' },
};

function mapOf(items: AttentionItem[]): LiveMap {
  return liveReducer({}, { type: 'attention', items, server, now });
}

describe('planLiveSurfaces', () => {
  it('shows candidates, holds an ending item, finishes a terminal one and drops the rest', () => {
    let map = mapOf([run, chat]);
    map = liveReducer(map, { type: 'attention', items: [chat], server, now }); // r1 ends: awaiting its outcome
    const candidates = [map['s:chat:c1']!];
    expect(planLiveSurfaces(['s:workflow_run:r1', 's:chat:gone'], map, candidates)).toEqual({
      show: candidates, hold: ['s:workflow_run:r1'], finish: [], drop: ['s:chat:gone'],
    });
    map = liveReducer(map, { type: 'ended', key: 's:workflow_run:r1', outcome: 'failed', now });
    const plan = planLiveSurfaces(['s:workflow_run:r1'], map, []);
    expect(plan.finish.map((f) => [f.key, f.at.getTime() - now.getTime()])).toEqual([['s:workflow_run:r1', 30 * 60_000]]);
  });

  it('drops a still-running item that is no longer a candidate (unfollowed or switched off)', () => {
    expect(planLiveSurfaces(['s:chat:c1'], mapOf([chat]), []).drop).toEqual(['s:chat:c1']);
  });
});

describe('toLiveActivityProps', () => {
  it('draws a gate redacted for the Lock Screen, with its review link, tones and stage text', () => {
    const props = toLiveActivityProps(mapOf([run, ask])['s:workflow_run:r1']!, palette);
    expect(props).toMatchObject({
      title: 'Nightly audit', status: 'Needs you', tone: 'WARN', symbol: 'hand.raised',
      headline: 'Allow Bash?', detail: 'Needs you · Apply upgrades', progress: '3/6', stage: 'Stage 3 of 6',
      reviewUrl: 'generatorai:///workflows/w/runs/r1/stages/s3/approval?server=s', ended: false,
    });
    expect(props.number).toBeUndefined();
    expect(props.palette).toEqual({ fg: 'f1', fg2: 'f2', fg3: 'f3', line: 'li', surface: 'su', raised: 'ra', accent: 'ac', onAccent: 'oa' });
  });

  it('turns a chat tool step into its verb and colours segments by state', () => {
    const map = liveReducer(mapOf([chat]), { type: 'progress', key: 's:chat:c1', segments: ['done', 'current', 'pending'], now });
    const props = toLiveActivityProps(map['s:chat:c1']!, palette);
    expect(props).toMatchObject({ headline: 'Running', detail: 'Running', tone: 'RUN', segments: ['OK', 'RUN', 'li'] });
    expect(props.stage).toBeUndefined();
    expect(props.reviewUrl).toBeUndefined();
  });

  it('shows the outcome once it ended', () => {
    const map = liveReducer(mapOf([run]), { type: 'ended', key: 's:workflow_run:r1', outcome: 'cancelled', now });
    const props = toLiveActivityProps(map['s:workflow_run:r1']!, palette);
    expect(props).toMatchObject({ status: 'Cancelled', ended: true, headline: 'Cancelled', detail: 'Apply upgrades', symbol: 'minus.circle' });
  });

  it('keeps the status word next to a step label', () => {
    expect(liveLines(mapOf([run])['s:workflow_run:r1']!)).toEqual({ headline: 'Apply upgrades', detail: 'Running' });
  });
});

describe('toAndroidLiveUpdate', () => {
  it('draws a gate as a promoted ongoing notification with derived stages and the tracker on the current one', () => {
    const u = toAndroidLiveUpdate(mapOf([run, ask])['s:workflow_run:r1']!, hexPalette);
    expect(u).toMatchObject({
      key: 's:workflow_run:r1', title: 'Allow Bash?', text: 'Nightly audit · Needs you · Apply upgrades', chip: 'Needs you 3/6',
      tracker: 'needs_you', ongoing: true, indeterminate: false, progress: 250, whenMs: now.getTime(),
      reviewUrl: 'generatorai:///workflows/w/runs/r1/stages/s3/approval?server=s', reviewLabel: 'Review',
    });
    expect(u.segments.map((x) => x.color)).toEqual([
      hexToArgb('#7fd962'), hexToArgb('#7fd962'), hexToArgb('#ffb454cc'), hexToArgb('#2d3644'), hexToArgb('#2d3644'), hexToArgb('#2d3644'),
    ]);
    expect(u.subText).toBeUndefined();
  });

  it('is indeterminate without stages and dismissible once it ended', () => {
    const live = toAndroidLiveUpdate(mapOf([chat])['s:chat:c1']!, hexPalette);
    expect(live).toMatchObject({ indeterminate: true, segments: [], chip: 'Running', title: 'Running' });
    const map = liveReducer(mapOf([run]), { type: 'ended', key: 's:workflow_run:r1', outcome: 'succeeded', now });
    const done = toAndroidLiveUpdate(map['s:workflow_run:r1']!, hexPalette);
    expect(done).toMatchObject({ ongoing: false, tracker: 'done', indeterminate: false, progress: 600 });
    expect(done.chip).toBeUndefined();
  });

  it('converts CSS hex to signed ARGB and keeps notification ids stable and positive', () => {
    expect(hexToArgb('#ffffff')).toBe(-1);
    expect(hexToArgb('#000')).toBe(-16777216);
    expect(hexToArgb('#11223380')).toBe(((0x80 << 24) | 0x112233) | 0);
    expect(hexToArgb('oklch(1 0 0)')).toBe(0);
    const id = liveNotificationId('s:chat:c1');
    expect(id).toBe(liveNotificationId('s:chat:c1'));
    expect(id).toBeGreaterThanOrEqual(0x10000000);
    expect(id).toBeLessThan(0x20000000);
    expect(liveNotificationId('s:chat:c2')).not.toBe(id);
  });
});
