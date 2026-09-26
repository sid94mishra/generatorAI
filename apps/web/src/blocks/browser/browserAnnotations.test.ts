// Native annotations → attachments, and device-emulation mapping.
import { describe, expect, it } from 'vitest';

import { annotationFileStem, annotationMarkdown, annotationMarkdownFile, annotationScreenshotFile, type PickedElement } from './browserAnnotations.js';
import { DEVICE_PRESETS, emulationParams, emulationZoom, findDevicePreset, ZOOM_LEVELS } from './deviceEmulation.js';

const picked: PickedElement = {
  url: 'https://example.com/',
  tag: 'button',
  id: 'buy',
  classes: ['btn', 'primary'],
  label: 'button#buy',
  text: 'Buy now',
  cssSelector: '#buy',
  xpath: '/html/body/button',
  outerHtml: '<button id="buy">Buy now</button>',
  boundingBox: { x: 10.4, y: 20.6, width: 99.5, height: 30.2 },
  computedStyle: { color: 'red' },
  comment: '  make it bigger  ',
};

describe('annotationMarkdown', () => {
  it('writes the request, the element summary, the HTML and the computed CSS', () => {
    const md = annotationMarkdown(picked);
    expect(md).toContain('**Requested change:** make it bigger');
    expect(md).toContain('- **Tag:** `button` · **id:** `buy` · **classes:** `btn primary`');
    expect(md).toContain('- **Text:** Buy now');
    expect(md).toContain('- **Box:** 100×30 @ (10, 21)');
    expect(md).toContain('```html\n<button id="buy">Buy now</button>\n```');
    expect(md).toContain('## Computed CSS\n```css\n#buy {\n  color: red;\n}\n```');
  });

  it('says so when there is no comment, and omits the empty parts', () => {
    const md = annotationMarkdown({ ...picked, comment: undefined, id: null, classes: [], text: '', computedStyle: undefined });
    expect(md).toContain('**Requested change:** _(none provided)_');
    expect(md).toContain('- **Tag:** `button`\n');
    expect(md).not.toContain('**Text:**');
    expect(md).not.toContain('Computed CSS');
  });
});

describe('annotation files', () => {
  it('names files after the id (or tag) and the stamp', () => {
    expect(annotationFileStem(picked, 's1')).toBe('element-buy-s1');
    expect(annotationFileStem({ ...picked, id: null, tag: 'my tag!' }, 's1')).toBe('element-my-tag--s1');
    expect(annotationFileStem({ ...picked, id: 'x'.repeat(40) }, 's1')).toBe(`element-${'x'.repeat(32)}-s1`);
    const md = annotationMarkdownFile(picked, 'element-buy-s1');
    expect(md.name).toBe('element-buy-s1.md');
    expect(md.type).toBe('text/markdown');
  });

  it('decodes the cropped screenshot into a PNG', async () => {
    const png = annotationScreenshotFile(`data:image/png;base64,${btoa('abc')}`, 'element-buy-s1');
    expect(png.name).toBe('element-buy-s1.png');
    expect(png.type).toBe('image/png');
    expect(await png.text()).toBe('abc');
  });
});

describe('device emulation', () => {
  it('has the presets and zoom levels of the toolbar', () => {
    expect(DEVICE_PRESETS[0]).toEqual({ id: 'responsive', label: 'Responsive', width: 0, height: 0, mobile: false });
    expect(ZOOM_LEVELS[0]).toBe(0.5);
    expect(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]).toBe(2);
    expect(findDevicePreset('iphone')).toMatchObject({ width: 390, height: 844, mobile: true });
    expect(findDevicePreset('nope').id).toBe('responsive');
  });

  it('turns emulation off when disabled, responsive or unsized', () => {
    const base = { on: true, preset: 'iphone', width: 390, height: 844, dpr: 2, mobile: true, zoom: 1.25 };
    expect(emulationParams(base)).toEqual({ width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    expect(emulationParams({ ...base, on: false })).toBeNull();
    expect(emulationParams({ ...base, preset: 'responsive' })).toBeNull();
    expect(emulationParams({ ...base, width: 0 })).toBeNull();
    expect(emulationZoom(base)).toBe(1.25);
    expect(emulationZoom({ ...base, on: false })).toBe(1);
  });
});
