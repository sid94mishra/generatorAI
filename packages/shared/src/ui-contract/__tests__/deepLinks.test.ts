import { describe, expect, it } from 'vitest';
import { deepLinkToRoute, DEEP_LINK_QUERY_KEYS, PAIRING_LINK_BEHAVIOR } from '../deepLinks.js';

describe('deep links', () => {
  it('keeps only shared queries and removes fragments', () => {
    expect(DEEP_LINK_QUERY_KEYS).toEqual(['pair', 'dock', 'tab', 'kind', 'run', 'server', 'code']);
    expect(deepLinkToRoute('generatorai:///chats/c?dock=changes&server=B&token=secret#action')).toBe('/chats/c?dock=changes&server=B');
    expect(deepLinkToRoute('generatorai://')).toBe('/');
  });
  it('only opens the pairing entry with a prefilled code', () => {
    expect(PAIRING_LINK_BEHAVIOR).toBe('prefill-only');
    for (const url of ['generatorai://pair?code=A+B', 'generatorai://pair?pair=A+B', '/?pair=A+B']) {
      expect(deepLinkToRoute(url)).toBe('/pair?code=A%20B');
    }
  });
  it('only resolves explicitly registered command UIs', () => {
    expect(deepLinkToRoute('generatorai://command/chat.new')).toBe('/chats/new');
    expect(deepLinkToRoute('generatorai://command/workflow.new')).toBe('/workflows/new');
    expect(deepLinkToRoute('generatorai://command/project.new')).toBeNull();
    expect(deepLinkToRoute('generatorai://command/chat.new/extra')).toBeNull();
  });
  it.each(['https://evil.test/chats', '//chats/c', '/chats/../settings', '/chats/%2e%2e/settings', '/chats/%252e%252e', '/chats/%2Fetc', '/chats/%5cetc', '/chats/%00', '/chats/%', '/chats/c?server=A&server=B', '/chats/c?server=../B', '/admin', 'generatorai://evil.test@chats'])('rejects %s', (input) => {
    expect(deepLinkToRoute(input)).toBeNull();
  });
});
