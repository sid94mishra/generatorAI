import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FONT_FAMILY,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  SCROLLBACK_LINES,
  clampFontSize,
  sanitizeTheme,
  terminalHtml,
} from '../terminal/terminalHtml';
import { XTERM_CSS, XTERM_JS, XTERM_VERSIONS } from '../terminal/xtermBundle.generated';

const SRC = path.resolve(__dirname, '..');

const THEME = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#e6edf3',
  selectionBackground: '#4493f866',
  red: '#e06c75',
  brightWhite: '#ffffff',
};

describe('vendored xterm bundle', () => {
  it('exists and carries the emulator', () => {
    expect(fs.existsSync(path.join(SRC, 'terminal', 'xtermBundle.generated.ts'))).toBe(true);
    // The UMD build's module epilogue; if the string were truncated or
    // mis-escaped this is the first thing to go.
    expect(XTERM_JS.length).toBeGreaterThan(100_000);
    expect(XTERM_JS).toContain('Terminal');
    expect(XTERM_CSS).toContain('.xterm');
    expect(XTERM_VERSIONS['@xterm/xterm']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('cannot close the script element it is inlined into', () => {
    expect(/<\/script/i.test(XTERM_JS)).toBe(false);
    expect(/<\/style/i.test(XTERM_CSS)).toBe(false);
  });

  it('is imported only by terminalHtml.ts, and terminalHtml.ts only by TerminalView', () => {
    // The bundle is ~570 KB of string literal. One static importer on the
    // startup path and every cold start pays for it.
    const importers = (needle: RegExp) =>
      walk(SRC)
        .filter((file) => /\.(ts|tsx)$/.test(file) && !file.includes('__tests__'))
        .filter((file) => needle.test(fs.readFileSync(file, 'utf8')))
        .map((file) => path.relative(SRC, file).replace(/\\/g, '/'));

    expect(importers(/from\s+['"][^'"]*xtermBundle\.generated['"]/)).toEqual([
      'terminal/terminalHtml.ts',
    ]);
    // Static `from './terminalHtml'` imports: none. TerminalView uses a
    // dynamic `import('./terminalHtml')` instead.
    expect(importers(/^\s*import\s[^;]*from\s+['"][^'"]*\/terminalHtml['"]/m)).toEqual([]);
    expect(importers(/import\(['"]\.\/terminalHtml['"]\)/)).toEqual(['terminal/TerminalView.tsx']);
  });
});

describe('terminalHtml()', () => {
  const html = terminalHtml({ theme: THEME, fontSize: 12 });

  it('inlines xterm and the addons', () => {
    expect(html).toContain('<script>!function(e,t)');
    expect(html).toContain('new Terminal(');
    expect(html).toContain('FitAddon');
    expect(html).toContain('SearchAddon');
    expect(html).toContain('WebLinksAddon');
    expect(html).toContain('.xterm');
  });

  it('loads nothing from the network', () => {
    expect(html).not.toMatch(/\ssrc\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/\shref\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/\burl\(\s*["']?https?:/i);
  });

  it('bakes the theme, font size and scrollback cap into the config', () => {
    expect(html).toContain('"background":"#0d1117"');
    expect(html).toContain('"brightWhite":"#ffffff"');
    expect(html).toContain('"fontSize":12');
    expect(html).toContain(`"scrollback":${SCROLLBACK_LINES}`);
    expect(html).toContain(JSON.stringify(DEFAULT_FONT_FAMILY));
    expect(html).toContain('background: #0d1117;');
  });

  it('keeps the bridge contract', () => {
    for (const type of [
      "'ready'",
      "'input'",
      "'resize'",
      "'title'",
      "'link'",
      "'hwkey'",
      "'searchResult'",
      "'bell'",
      "'selection'",
    ]) {
      expect(html, type).toContain(`type: ${type}`);
    }
    for (const incoming of [
      "'data'",
      "'clear'",
      "'theme'",
      "'fit'",
      "'fontSize'",
      "'search'",
      "'searchNext'",
      "'searchPrev'",
      "'clearSearch'",
      "'scrollToBottom'",
    ]) {
      expect(html, incoming).toContain(`case ${incoming}:`);
    }
  });

  it('feeds bytes, not decoded text, into xterm so split UTF-8 survives', () => {
    expect(html).toContain('term.write(decodeBase64(');
  });
});

describe('theme sanitisation', () => {
  it('drops unknown keys and invalid colours, keeps valid ones', () => {
    const out = sanitizeTheme({
      background: '#fff',
      foreground: 'rgb(1, 2, 3)',
      red: '</style><script>alert(1)</script>',
      evil: '#000',
      blue: 'url(http://x)',
      cyan: undefined,
    } as Record<string, string | undefined>);
    expect(out).toEqual({ background: '#fff', foreground: 'rgb(1, 2, 3)' });
  });

  it('guarantees background and foreground', () => {
    expect(sanitizeTheme({})).toEqual({ background: '#0d1117', foreground: '#e6edf3' });
  });

  it('never lets a hostile colour into the document', () => {
    const html = terminalHtml({
      theme: { background: '</style><script>alert(1)</script>', foreground: 'x;}body{' },
    });
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('body{');
  });

  it('escapes < inside the embedded config', () => {
    const html = terminalHtml({ theme: THEME, fontFamily: 'Menlo, monospace' });
    const config = /var CONFIG = (\{.*?\});\n/.exec(html)?.[1] ?? '';
    expect(config).not.toContain('<');
    expect(JSON.parse(config).fontFamily).toBe('Menlo, monospace');
  });
});

describe('font size', () => {
  it('clamps to the pinch bounds', () => {
    expect(clampFontSize(undefined)).toBe(12);
    expect(clampFontSize(Number.NaN)).toBe(12);
    expect(clampFontSize(1)).toBe(FONT_SIZE_MIN);
    expect(clampFontSize(99)).toBe(FONT_SIZE_MAX);
    expect(clampFontSize(13.6)).toBe(14);
  });

  it('is applied to the document', () => {
    expect(terminalHtml({ theme: THEME, fontSize: 40 })).toContain(`"fontSize":${FONT_SIZE_MAX}`);
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
