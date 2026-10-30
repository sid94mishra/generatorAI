// Browser comments → attachments, and device-emulation mapping.
import { describe, expect, it } from 'vitest';

import { BROWSER_COMMENT_FILE, commentFiles, commentsMarkdown, fileStamp, type PickedElement } from './browserAnnotations.js';
import { DEVICE_PRESETS, deviceFrame, emulationParams, findDevicePreset, ZOOM_LEVELS } from './deviceEmulation.js';

const png = `data:image/png;base64,${btoa('abc')}`;
const button: PickedElement = {
  key: 'a1',
  n: 1,
  url: 'https://example.com/pricing',
  title: 'Pricing',
  tag: 'button',
  id: 'buy',
  classes: ['btn', 'primary'],
  label: 'button#buy.btn.primary',
  text: 'Buy now',
  cssSelector: '#buy',
  xpath: '/html/body/button',
  outerHtml: '<button id="buy">Buy now</button>',
  boundingBox: { x: 10.4, y: 20.6, width: 99.5, height: 30.2 },
  computedStyle: { color: 'red' },
  comment: '  Make it the primary colour  ',
  screenshot: png,
};
const area: PickedElement = {
  key: 'a2',
  n: 2,
  url: 'https://example.com/pricing',
  tag: 'area',
  id: null,
  classes: [],
  label: 'area 640×220',
  text: '',
  cssSelector: '',
  xpath: '',
  outerHtml: '',
  boundingBox: { x: 0, y: 300, width: 640, height: 220 },
  viewport: { width: 1280, height: 800 },
  comment: 'The cards overflow here',
  screenshot: null,
};

describe('commentsMarkdown', () => {
  it('lists every numbered comment with its element or area, once, under the page', () => {
    const md = commentsMarkdown([button, area], 'browser-comments-s1');
    expect(md).toContain('# Browser comments (2)');
    expect(md).toContain('Page: Pricing — https://example.com/pricing');
    expect(md).toContain('## 1. Make it the primary colour');
    expect(md).toContain('- **Element:** `button#buy.btn.primary`');
    expect(md).toContain('- **Selector:** `#buy`');
    expect(md).toContain('- **Text:** “Buy now”');
    expect(md).toContain('- **Screenshot:** `browser-comments-s1-1.png`');
    expect(md).toContain('```html\n<button id="buy">Buy now</button>\n```');
    expect(md).toContain('#buy {\n  color: red;\n}');
    expect(md).toContain('## 2. The cards overflow here');
    expect(md).toContain('- **Area:** 640×220 at (0, 300) in a 1280×800 viewport');
    // No screenshot was captured for the area, so none is referenced.
    expect(md).not.toContain('browser-comments-s1-2.png');
  });
});

describe('commentFiles', () => {
  it('makes one Markdown file plus a PNG per captured comment', async () => {
    const files = commentFiles([button, area], 's1');
    expect(files.map((f) => f.name)).toEqual(['browser-comments-s1.md', 'browser-comments-s1-1.png']);
    expect(files[0]!.type).toBe('text/markdown');
    expect(files[1]!.type).toBe('image/png');
    expect(await files[1]!.text()).toBe('abc');
    expect(files.every((f) => BROWSER_COMMENT_FILE.test(f.name))).toBe(true);
    expect(commentFiles([], 's1')).toEqual([]);
  });

  it('stamps files sortably', () => {
    expect(fileStamp(new Date(2026, 9, 11, 9, 5, 7))).toBe('20261011-090507');
  });
});

describe('device mode (D-144)', () => {
  it('has the presets and zoom levels of the toolbar, Fit first', () => {
    expect(DEVICE_PRESETS[0]).toEqual({ id: 'responsive', label: 'Responsive', width: 0, height: 0, mobile: false });
    expect(ZOOM_LEVELS[0]).toBe(0);
    expect(findDevicePreset('iphone')).toMatchObject({ width: 390, height: 844, mobile: true });
    expect(findDevicePreset('nope').id).toBe('responsive');
  });

  it('emulates whenever device mode is on — Responsive uses the width and height fields', () => {
    const base = { on: true, preset: 'iphone', width: 390, height: 844, dpr: 3, mobile: true, zoom: 0 };
    expect(emulationParams(base, 0.8)).toEqual({ width: 390, height: 844, deviceScaleFactor: 3, mobile: true, scale: 0.8 });
    expect(emulationParams({ ...base, preset: 'responsive', width: 600, height: 900, mobile: false })).toMatchObject({ width: 600, height: 900, mobile: false, scale: 1 });
    expect(emulationParams({ ...base, on: false })).toBeNull();
    expect(emulationParams({ ...base, width: 0 })).toBeNull();
  });

  it('fits the frame to the panel (never enlarging), or uses the chosen zoom', () => {
    const fit = deviceFrame({ width: 390, height: 844 }, { width: 500, height: 448 }, 0);
    expect(fit.scale).toBeCloseTo(424 / 844);
    expect(fit.height).toBe(424);
    expect(deviceFrame({ width: 390, height: 844 }, { width: 2000, height: 2000 }, 0).scale).toBe(1);
    expect(deviceFrame({ width: 390, height: 844 }, { width: 500, height: 448 }, 0.5)).toEqual({ width: 195, height: 422, scale: 0.5 });
  });
});
