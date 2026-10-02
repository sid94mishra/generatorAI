import { describe, expect, it } from 'vitest';

import { addressToUrl, classifyFailure, commentForChat, framePointToPage, selectionFrom, urlParts } from './browserModel';

describe('browser view (MB-28, MD-114)', () => {
  it('maps a tap on the letterboxed frame to page coordinates', () => {
    // A 390×844 page drawn in a 300×300 view: scale 300/844, centred horizontally.
    const view = { width: 300, height: 300 };
    const page = { width: 390, height: 844 };
    const scale = 300 / 844;
    const left = (300 - 390 * scale) / 2;
    expect(framePointToPage({ x: left + 195 * scale, y: 422 * scale }, view, page)).toEqual({ x: 195, y: 422 });
    expect(framePointToPage({ x: 2, y: 150 }, view, page)).toBeNull();
    expect(framePointToPage({ x: 10, y: 10 }, { width: 0, height: 0 }, page)).toBeNull();
  });

  it('reads the address bar and splits the URL pill', () => {
    expect(addressToUrl('localhost:5173/checkout')).toBe('https://localhost:5173/checkout');
    expect(addressToUrl(' http://a.test ')).toBe('http://a.test');
    expect(addressToUrl('')).toBe('');
    expect(urlParts('http://localhost:5173/checkout?a=1')).toEqual({ host: 'localhost:5173', path: '/checkout?a=1' });
    expect(urlParts('https://example.com/')).toEqual({ host: 'example.com', path: '' });
  });

  it('takes the inspector pick from the stream and words it for the chat', () => {
    const sel = selectionFrom({ kind: 'browser.selection', data: { artifactId: 'a1', url: 'http://x/', cssSelector: 'div.summary > .total' } });
    expect(sel).toEqual({ artifactId: 'a1', url: 'http://x/', cssSelector: 'div.summary > .total', xpath: '' });
    expect(selectionFrom({ kind: 'browser.navigation', data: {} })).toBeNull();
    expect(commentForChat(sel!, 'Total does not update')).toBe('Total does not update\n\nElement: div.summary > .total\nPage: http://x/');
  });

  it('tells a full pool from a page that did not load', () => {
    expect(classifyFailure('max concurrent (5) reached', '').kind).toBe('poolFull');
    expect(classifyFailure('net::ERR_CONNECTION_REFUSED', 'http://localhost:5173/x')).toEqual({ kind: 'loadFailed', detail: 'net::ERR_CONNECTION_REFUSED', host: 'localhost:5173' });
    expect(classifyFailure('boom', '').kind).toBe('other');
  });
});
