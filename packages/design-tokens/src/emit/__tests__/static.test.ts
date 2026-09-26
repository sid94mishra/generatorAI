// ────────────────────────────────────────────────────────────────
// Static desktop pages emitter (06 §7; P5-11). The real risk: splash/error/
// prompt run with no script (`default-src 'none'`) and no localStorage, so a
// missing variable or a dark block outside its media query silently ships a
// broken or flashing page with nothing to catch it at runtime.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { DESIGN_COLOR_VARS } from '../../design.js';
import { spliceCss, TOKENS_END_MARKER, TOKENS_START_MARKER } from '../css.js';
import { emitStaticCss } from '../static.js';

const css = emitStaticCss();
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');

describe('static desktop page emitter', () => {
  it('opens with a light :root block, ahead of the dark media query', () => {
    expect(css.indexOf(':root {')).toBe(0);
    expect(darkStart).toBeGreaterThan(0);
  });

  it('declares light-dark color-scheme, so native form controls follow the OS', () => {
    expect(css).toContain('color-scheme: light dark;');
  });

  it('emits every design colour once outside the media query and once inside it', () => {
    for (const [, name] of DESIGN_COLOR_VARS) {
      const light = css.slice(0, darkStart);
      const dark = css.slice(darkStart);
      expect(light, `${name} missing from the light block`).toContain(`${name}:`);
      expect(dark, `${name} missing from the dark block`).toContain(`${name}:`);
    }
  });

  it('emits the radius, type-scale and control-height variables the pages use', () => {
    expect(css).toContain('--gai-radius-panel:');
    expect(css).toContain('--gai-text-heading:');
    expect(css).toContain('--gai-h-control:');
  });

  it('points both bundled fonts at the local fonts/ directory next to the page, never a CDN', () => {
    expect(css).toContain("url('./fonts/instrument-sans-latin-wght-normal.woff2')");
    expect(css).toContain("url('./fonts/jetbrains-mono-latin-wght-normal.woff2')");
    expect(css).not.toMatch(/https?:\/\//);
  });

  it('splices into a page between the shared @generated-tokens markers', () => {
    const page = `<style>\n${TOKENS_START_MARKER}\n${TOKENS_END_MARKER}\n.wrap { color: red; }\n</style>`;
    const spliced = spliceCss(page, css);
    expect(spliced).toContain(css);
    expect(spliced).toContain('.wrap { color: red; }');
  });
});
