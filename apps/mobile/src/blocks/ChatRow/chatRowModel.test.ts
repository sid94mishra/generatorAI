import { describe, expect, it } from 'vitest';
import type { ChatRowModel } from '@generatorai/shared/ui-contract';
import { afterBulk, chatListEntries, chatRowMenu, chatRowSpokenMeta, chatRowSwipe, chatRowView, displayChatTitle, toggleAll } from './chatRowModel';

const model = (over: Partial<ChatRowModel> = {}): ChatRowModel => ({
  id: 'c1',
  title: 'Fix flaky checkout test',
  status: { state: 'needs_you' },
  archived: false,
  lastActivityAt: '2026-10-02T10:00:00.000Z',
  tags: [],
  ...over,
});

const ids = (entries: ReturnType<typeof chatRowMenu>) => entries.map((e) => ('type' in e ? '|' : e.id));

describe('ChatRow model (MB-48)', () => {
  it('strips the worker marker and never shows an empty title', () => {
    expect(displayChatTitle('⚙ Update snapshots')).toBe('Update snapshots');
    expect(displayChatTitle('  ')).toBe('Untitled chat');
  });

  it('shows the agent, or the model label only for agent-less rows (MG-03)', () => {
    expect(chatRowView(model({ agentName: 'Bug Fixer', modelLabel: 'Claude Sonnet 5', projectName: 'payments' }))).toMatchObject({ agent: 'Bug Fixer', project: 'payments' });
    expect(chatRowView(model({ agentName: 'Bug Fixer' })).model).toBeUndefined();
    expect(chatRowView(model({ modelLabel: 'Claude Sonnet 5' }))).toMatchObject({ model: 'Claude Sonnet 5' });
    expect(chatRowSpokenMeta(chatRowView(model({ agentName: 'Bug Fixer', projectName: 'payments' })))).toBe('project payments, agent Bug Fixer');
  });

  it('archived rows drop the status glyph and Pin / Unread; running rows offer Stop', () => {
    const archived = chatRowView(model({ archived: true, status: null }));
    expect(archived.status).toBeNull();
    expect(ids(chatRowMenu(archived))).toEqual(['open', '|', 'unarchive', '|', 'delete']);
    expect(chatRowSwipe(archived).leading).toEqual([]);
    const running = chatRowView(model({ status: { state: 'running' }, pinned: true, unread: true }));
    expect(ids(chatRowMenu(running))).toEqual(['open', 'unpin', 'mark-read', 'stop', '|', 'archive', '|', 'delete']);
  });

  it('swipes: Pin / Unread leading, More / Archive trailing — never Delete (MD-52)', () => {
    const swipe = chatRowSwipe(chatRowView(model()));
    expect(swipe.leading.map((a) => a.id)).toEqual(['pin', 'mark-unread']);
    expect(swipe.trailing.map((a) => a.id)).toEqual(['more', 'archive']);
    expect([...swipe.leading, ...swipe.trailing].some((a) => a.id === 'delete')).toBe(false);
  });

  it('sections pinned rows first only when one is pinned; flat for search and archive', () => {
    const rows = [chatRowView(model({ id: 'a', pinned: true })), chatRowView(model({ id: 'b' })), chatRowView(model({ id: 'c' }))];
    expect(chatListEntries(rows, { flat: false }).map((e) => e.key)).toEqual(['h-pinned', 'a', 'h-recent', 'b', 'c']);
    expect(chatListEntries(rows, { flat: true }).map((e) => e.key)).toEqual(['a', 'b', 'c']);
    expect(chatListEntries(rows.slice(1), { flat: false }).map((e) => e.key)).toEqual(['b', 'c']);
    // iOS inset groups (MChats): each section's rows carry their place in the group; flat lists carry none.
    const position = (e: ReturnType<typeof chatListEntries>[number]) => (e.type === 'row' ? (e.position ?? '-') : 'h');
    expect(chatListEntries(rows, { flat: false }).map(position)).toEqual(['h', 'only', 'h', 'first', 'last']);
    expect(chatListEntries(rows, { flat: true }).map(position)).toEqual(['-', '-', '-']);
  });

  it('select all toggles; after a bulk call only the failures stay selected (MD-60)', () => {
    expect([...toggleAll(new Set(), ['a', 'b'])]).toEqual(['a', 'b']);
    expect(toggleAll(new Set(['a', 'b']), ['a', 'b']).size).toBe(0);
    expect([...afterBulk(['b'])]).toEqual(['b']);
  });
});
