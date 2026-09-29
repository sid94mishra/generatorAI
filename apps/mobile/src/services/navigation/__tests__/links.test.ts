import { expect, it } from 'vitest';
import { createLinkQueue, linkDisposition, redirectLink, linkQueue } from '../links';

it('keeps cold-start links until auth is ready; an old completion cannot erase a new link', () => {
  const queue = createLinkQueue();
  queue.enqueue('generatorai://chats/a?server=A');
  const a = queue.getSnapshot()!;
  expect(linkDisposition(a, ['A', 'B'], 'B')).toBe('switch');
  expect(linkDisposition(a, ['A', 'B'], 'A')).toBe('open');
  queue.enqueue('/chats/b', 'B');
  expect(queue.finish(a)).toBe(false);
  expect(queue.getSnapshot()?.route).toBe('/chats/b?server=B');
});
it('unknown servers cannot open a matching entity on the active server', () => {
  const queue = createLinkQueue();
  queue.enqueue('/chats/shared?server=unknown');
  expect(linkDisposition(queue.getSnapshot()!, ['A'], 'A')).toBe('unknown');
  expect(queue.enqueue('/chats/c', '../other')).toBe(false);
});
it('native entry opens consent only; protected links wait for the shell', () => {
  expect(redirectLink('generatorai://chats/c?server=A')).toBe('/');
  expect(linkQueue.getSnapshot()?.serverId).toBe('A');
  expect(redirectLink('generatorai://pair?code=ABCD')).toBe('/pair?code=ABCD');
  expect(linkQueue.getSnapshot()).toBeNull();
  expect(redirectLink('https://evil.test')).toBe('/');
});

it('returns same-server targets directly so Expo cannot overwrite a queued navigation', () => {
  expect(redirectLink('generatorai:///chats/c?execute=delete', 'A')).toBe('/chats/c');
  expect(redirectLink('generatorai:///chats/c?server=A', 'A')).toBe('/chats/c?server=A');
  expect(linkQueue.getSnapshot()).toBeNull();
});
