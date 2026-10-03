import { describe, expect, it } from 'vitest';
import { liveReducer } from '@generatorai/client-core';
import type { AttentionItem } from '@generatorai/shared';

import type { WidgetPalette } from '../native/widgetPalette';
import { buildWidgetSnapshot, isUrgentWidgetChange } from './widgetSnapshot';

const now = new Date('2026-10-03T10:00:00Z');
const palette = { fg: 'f' } as WidgetPalette;
const item = (id: string, minutesAgo: number, extra: Partial<AttentionItem> = {}): AttentionItem => ({
  key: `chat:${id}`, entity: 'chat', entityId: id, title: `Chat ${id}`, href: `/chats/${id}`, state: 'running',
  since: new Date(now.getTime() - minutesAgo * 60_000).toISOString(), stoppable: true, ...extra,
});
const ask = (id: string, minutesAgo: number, summary: string): AttentionItem =>
  item(id, minutesAgo, { key: `chat:${id}:g`, href: `/chats/${id}/gate/g`, state: 'needs_you', ask: { kind: 'tool_permission', id: 'g', summary, actions: ['allow_once', 'deny'] } });

const items = [item('a', 5), item('b', 50), item('c', 1), item('d', 30), ask('e', 2, 'Allow Bash: git push -u origin x?'), ask('f', 9, 'Pick a branch')];
const map = liveReducer({}, { type: 'attention', items, server: { id: 's', name: 'Studio' }, now });

describe('buildWidgetSnapshot', () => {
  it('lists three of each, oldest first, redacted, with the feed counts', () => {
    const snap = buildWidgetSnapshot({ map, server: { id: 's', name: 'Studio' }, counts: { needsYou: 2, running: 4 }, palette, now: now.getTime() });
    expect(snap.counts).toEqual({ needsYou: 2, running: 4 });
    expect(snap.needsYou.map((i) => [i.title, i.sub, i.symbol])).toEqual([
      ['Chat f', 'Pick a branch', 'hand.raised'],
      ['Chat e', 'Allow Bash?', 'hand.raised'],
    ]);
    expect(snap.needsYou[1]!.url).toBe('generatorai:///chats/e/gate/g?server=s');
    expect(snap.running.map((i) => i.title)).toEqual(['Chat b', 'Chat d', 'Chat a']);
    expect(snap.homeUrl).toBe('generatorai:///?server=s');
  });

  it('counts the items itself without a feed, and is empty with no server', () => {
    const snap = buildWidgetSnapshot({ map, server: { id: 's', name: 'Studio' }, palette, now: 0 });
    expect(snap.counts).toEqual({ needsYou: 2, running: 4 });
    const none = buildWidgetSnapshot({ map, server: null, palette, now: 0 });
    expect(none).toMatchObject({ serverId: '', needsYou: [], running: [], homeUrl: 'generatorai:///' });
  });

  it('writes Needs-you changes at once and debounces the rest', () => {
    const base = buildWidgetSnapshot({ map, server: { id: 's', name: 'S' }, palette, now: 0 });
    const lessRunning = buildWidgetSnapshot({ map: liveReducer(map, { type: 'attention', items: items.slice(1), server: { id: 's', name: 'S' }, now }), server: { id: 's', name: 'S' }, palette, now: 1 });
    expect(isUrgentWidgetChange(null, base)).toBe(true);
    expect(isUrgentWidgetChange(base, lessRunning)).toBe(false);
    const answered = buildWidgetSnapshot({ map: liveReducer(map, { type: 'attention', items: items.slice(0, 5), server: { id: 's', name: 'S' }, now }), server: { id: 's', name: 'S' }, palette, now: 1 });
    expect(isUrgentWidgetChange(base, answered)).toBe(true);
  });
});
