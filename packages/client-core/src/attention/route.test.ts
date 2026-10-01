import { expect, it } from 'vitest';
import { attentionItemRoute } from './route.js';
it('preserves panes and replaces untrusted server identity', () => {
  expect(attentionItemRoute({ href: '/chats/c?dock=plan&server=wrong&action=allow' }, 'actual')).toEqual({ pathname: '/chats/c', params: { dock: 'plan', server: 'actual' } });
  expect(attentionItemRoute({ href: '/workflows/w/runs/r' }, 'B')).toEqual({ pathname: '/workflows/w/runs/r', params: { server: 'B' } });
});
it('rejects unsafe targets and pairing', () => {
  for (const href of ['https://evil.test', '//evil.test', '/chats/%2e%2e/settings', '/pair?code=x', '/admin']) expect(attentionItemRoute({ href }, 'A')).toBeNull();
  expect(attentionItemRoute({ href: '/chats/c' }, '../B')).toBeNull();
});
