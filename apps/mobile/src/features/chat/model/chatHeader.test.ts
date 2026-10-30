import { describe, expect, it } from 'vitest';

import { chatHeaderStatus, chatMenu, transcriptText, type ChatStatusInput } from './chatHeader';

const base: ChatStatusInput = { archived: false, gatePending: false, streamStatus: 'idle', stopped: false, lastTurn: null, detail: 'Bug Fixer', liveSince: null };

describe('chat header (MD-18, 04 §2.3)', () => {
  it('says what the chat is doing, with the agent or model after it', () => {
    expect(chatHeaderStatus({ ...base, streamStatus: 'streaming', liveSince: '2026-10-03T10:00:00.000Z' })).toEqual({ state: 'running', detail: 'Bug Fixer', elapsedSince: '2026-10-03T10:00:00.000Z' });
    expect(chatHeaderStatus({ ...base, streamStatus: 'pending' })).toMatchObject({ state: 'running', label: 'Starting' });
    expect(chatHeaderStatus({ ...base, streamStatus: 'streaming', gatePending: true })).toEqual({ state: 'needs_you', detail: 'Bug Fixer' });
    expect(chatHeaderStatus({ ...base, streamStatus: 'complete' })).toEqual({ state: 'succeeded', label: 'Done', detail: 'Bug Fixer' });
    expect(chatHeaderStatus({ ...base, streamStatus: 'complete', stopped: true })).toMatchObject({ state: 'skipped', label: 'Cancelled' });
    expect(chatHeaderStatus({ ...base, streamStatus: 'error' })).toMatchObject({ state: 'failed' });
    expect(chatHeaderStatus({ ...base, lastTurn: 'done', detail: null })).toEqual({ state: 'succeeded', label: 'Done' });
  });

  it('is silent for a chat that never ran or is archived', () => {
    expect(chatHeaderStatus(base)).toBeNull();
    expect(chatHeaderStatus({ ...base, archived: true, streamStatus: 'streaming' })).toBeNull();
  });

  it('offers the MDF-57 menu with the kept testIDs; Delete last and destructive', () => {
    const menu = chatMenu({ archived: false, hasMessages: true, streaming: false, canRewind: true, forking: false });
    const ids = menu.map((e) => ('type' in e ? '|' : e.id));
    expect(ids).toEqual(['rename', 'copy-transcript', 'share', 'fork', 'rewind', 'open-pane', '|', 'archive', '|', 'delete']);
    expect(menu.find((e) => !('type' in e) && e.id === 'fork')).toMatchObject({ testID: 'fork-chat' });
    expect(menu.find((e) => !('type' in e) && e.id === 'delete')).toMatchObject({ destructive: true });
    const archived = chatMenu({ archived: true, hasMessages: false, streaming: true, canRewind: true, forking: false });
    expect(archived.find((e) => !('type' in e) && e.id === 'unarchive')).toBeTruthy();
    expect(archived.find((e) => !('type' in e) && e.id === 'rewind')).toMatchObject({ disabled: true });
  });

  it('shares the transcript as plain text', () => {
    expect(transcriptText([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: ' Hello ' }, { role: 'assistant', content: '' }], 'Chat')).toBe('Chat\n\nYou: Hi\n\nAgent: Hello\n');
  });
});
