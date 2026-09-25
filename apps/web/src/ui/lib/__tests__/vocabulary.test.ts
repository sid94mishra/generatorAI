// Compile test for the shared class vocabulary (02 §10.2): compiles
// `@import "tailwindcss"; @import "<vocabulary.css>";` with the Tailwind
// version the app builds with, and asserts each design utility produces a
// rule that reads the expected `--gai-*` variable. Catches a namespace Tailwind
// does not know (e.g. `--text-color-*`), a typo in the generated mapping, or a
// Tailwind upgrade that renames a namespace.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

async function loadStylesheet(id: string, base: string) {
  const path = id.startsWith('.')
    ? resolve(base, id)
    : require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
  return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
}

/** The declaration block of `.cls` in `css`, or null. */
function rule(css: string, cls: string): string | null {
  const escaped = cls.replace(/[^\w-]/g, (c) => `\\\\${c}`);
  const m = new RegExp(`\\.${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return m ? m[1]! : null;
}

let build: (candidates: string[]) => string;

beforeAll(async () => {
  const compiler = await compile('@import "tailwindcss";\n@import "@generatorai/design-tokens/css/vocabulary.css";\n', {
    base: dirname(fileURLToPath(import.meta.url)),
    loadStylesheet,
  });
  build = (candidates) => compiler.build(candidates);
});

describe('design vocabulary compiles to --gai-* utilities', () => {
  it.each([
    ['bg-ground', 'background-color: var(--gai-ground)'],
    ['bg-surface', 'background-color: var(--gai-surface)'],
    ['bg-hover', 'background-color: var(--gai-hover)'],
    ['text-fg-2', 'color: var(--gai-fg-2)'],
    ['border-line-strong', 'border-color: var(--gai-line-strong)'],
    ['text-on-accent', 'color: var(--gai-on-accent)'],
    ['outline-focus', 'outline-color: var(--gai-focus)'],
    ['bg-run-bg', 'background-color: var(--gai-run-bg)'],
    ['bg-chart-1', 'background-color: var(--chart-1)'],
  ])('%s → %s', (cls, declaration) => {
    const css = build([cls]);
    expect(rule(css, cls), css).toContain(declaration);
  });

  it('text-<status> reads the AA-safe text value, bg-<status> the hue', () => {
    const css = build(['text-run', 'bg-run', 'text-err', 'border-err']);
    expect(rule(css, 'text-run')).toContain('color: var(--gai-run-text)');
    expect(rule(css, 'bg-run')).toContain('background-color: var(--gai-run)');
    expect(rule(css, 'text-err')).toContain('color: var(--gai-err-text)');
    expect(rule(css, 'border-err')).toContain('border-color: var(--gai-err)');
  });

  it('variants work on design utilities', () => {
    const css = build(['hover:bg-hover', 'aria-selected:bg-selected']);
    expect(css).toContain('.hover\\:bg-hover');
    expect(css).toContain('background-color: var(--gai-hover)');
    expect(css).toContain('.aria-selected\\:bg-selected');
    expect(css).toContain('background-color: var(--gai-selected)');
  });

  it.each([
    ['text-ui', ['font-size: var(--gai-text-ui)', 'line-height: var(--tw-leading, var(--gai-leading-ui))']],
    ['text-title', ['font-size: var(--gai-text-title)', 'font-weight: var(--tw-font-weight, var(--gai-weight-title))']],
    ['text-heading', ['letter-spacing: var(--tw-tracking, var(--gai-tracking-heading))']],
    ['rounded-card', ['border-radius: var(--gai-radius-card)']],
    ['rounded-t-dialog', ['var(--gai-radius-dialog)']],
    ['h-row', ['height: var(--gai-h-row)']],
    ['min-h-control', ['min-height: var(--gai-h-control)']],
    ['size-control', ['width: var(--gai-h-control)', 'height: var(--gai-h-control)']],
    ['z-dialog', ['z-index: var(--gai-z-dialog)']],
    ['w-sidebar', ['width: var(--gai-w-sidebar)']],
    ['max-w-dialog', ['max-width: var(--gai-w-dialog)']],
    ['ease-standard', ['var(--gai-ease-standard)']],
  ])('scale utility %s', (cls, declarations) => {
    const css = build([cls]);
    const body = rule(css, cls);
    for (const declaration of declarations) expect(body, css).toContain(declaration);
  });

  it('text-ui does not force a weight, so it inherits one', () => {
    expect(rule(build(['text-ui']), 'text-ui')).not.toContain('font-weight');
  });

  it('shadow-pop is the design shadow', () => {
    expect(rule(build(['shadow-pop']), 'shadow-pop')).toContain('var(--gai-shadow-pop)');
  });
});
