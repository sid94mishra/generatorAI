import { describe, expect, it } from 'vitest';
import { highlightCode, isSupportedLang, LANG_LOADERS, withPreChrome } from './highlighter.js';

describe('isSupportedLang', () => {
  it('recognizes a language with a registered loader', () => {
    expect(isSupportedLang('typescript')).toBe(true);
    expect(Object.hasOwn(LANG_LOADERS, 'typescript')).toBe(true);
  });

  it('rejects an unregistered or missing language', () => {
    expect(isSupportedLang('cobol')).toBe(false);
    expect(isSupportedLang(undefined)).toBe(false);
  });
});

describe('highlightCode', () => {
  it('falls back to escaped plain text for an unsupported language', async () => {
    const html = await highlightCode('<b>not html</b>', 'cobol');
    // Shiki escapes text content (numeric entities); it must never emit a literal <b> element.
    expect(html).not.toContain('<b>not html</b>');
    expect(html).toContain('not html');
  });

  it('falls back to plain text when no language is given', async () => {
    const html = await highlightCode('plain line', undefined);
    expect(html).toContain('plain line');
  });

  it(
    'highlights a supported language using the CSS-variable theme',
    async () => {
      const html = await highlightCode('const x = 1;', 'typescript');
      expect(html).toContain('var(--syntax-keyword)');
      expect(html).toContain('const');
    },
    20_000,
  );
});

describe('withPreChrome', () => {
  it('replaces the <pre> wrapper attributes with plain kit classes', () => {
    const shikiOutput = '<pre class="shiki" style="background-color:transparent"><code>x</code></pre>';
    const html = withPreChrome(shikiOutput, false);
    expect(html).toBe('<pre class="m-0 bg-transparent p-0 whitespace-pre"><code>x</code></pre>');
  });

  it('uses whitespace-pre-wrap when wrap is true', () => {
    const html = withPreChrome('<pre class="shiki">x</pre>', true);
    expect(html).toContain('whitespace-pre-wrap');
  });
});
