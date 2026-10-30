import { afterEach, expect, it } from 'vitest';
import { onlineManager } from '@tanstack/react-query';
import { assertServerWriteAllowed } from '../offlinePolicy';
afterEach(() => onlineManager.setOnline(true));
it('rejects offline actions while permitting reads and stream recovery', () => {
  onlineManager.setOnline(false);
  for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) expect(() => assertServerWriteAllowed('/api/chats/c1', method)).toThrow('Server offline');
  expect(() => assertServerWriteAllowed('/api/chats', 'GET')).not.toThrow();
  expect(() => assertServerWriteAllowed('/api/stream/connections', 'POST')).not.toThrow();
  expect(() => assertServerWriteAllowed('/api/stream/connections/c1/subs', 'POST')).not.toThrow();
  expect(() => assertServerWriteAllowed('/api/stream/connections-evil', 'POST')).toThrow();
  onlineManager.setOnline(true);
  expect(() => assertServerWriteAllowed('/api/chats/c1', 'POST')).not.toThrow();
});
