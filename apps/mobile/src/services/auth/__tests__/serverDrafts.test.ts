import { expect, it, vi } from 'vitest';
const disk = vi.hoisted(() => new Map<string, string>());
vi.mock('../../storage/prefs', () => ({ prefs: { getString: (key: string) => disk.get(key), setString: (key: string, value: string) => disk.set(key, value), delete: (key: string) => disk.delete(key) } }));
import { createDraftStore } from '../../../components/chat/composer/draftStore';
it('keeps equal chat ids and late writes isolated across server changes', () => {
  const a = createDraftStore('a'); const b = createDraftStore('b');
  a.writeDraft('same-chat', 'A draft');
  b.writeDraft('same-chat', 'B draft');
  const lateWrite = () => a.writeDraft('same-chat', 'A late draft');
  lateWrite();
  expect(a.readDraft('same-chat')).toBe('A late draft');
  expect(b.readDraft('same-chat')).toBe('B draft');
  a.recordSentPrompt({ id: 'a1', text: 'A prompt', ts: 1 });
  expect(b.readLocalHistory()).toEqual([]);
  a.clearDraft('same-chat');
  expect(b.readDraft('same-chat')).toBe('B draft');
  createDraftStore(null).writeDraft('same-chat', 'unpaired');
  expect(createDraftStore(null).readDraft('same-chat')).toBe('');
});
