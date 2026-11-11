// D-132 — the provider-logo registry and ProviderLogo. Every provider this
// build supports has its own entry with a source and licence; an unknown id
// gets the neutral mark (never another vendor's); `color` uses the brand
// colour only where the brand has one; decorative unless labelled.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GENERIC_PROVIDER_LOGO, PROVIDER_LOGOS, providerLogo } from '@generatorai/design-tokens';
import { HARNESS_PROVIDER_IDS } from '@generatorai/shared';

import { ProviderLogo } from '@/ui/primitives/ProviderLogo/ProviderLogo.js';

describe('PROVIDER_LOGOS', () => {
  it.each([...HARNESS_PROVIDER_IDS, 'faux'])('%s has an entry with path data, a source and a licence', (id) => {
    const def = (PROVIDER_LOGOS as Record<string, (typeof PROVIDER_LOGOS)[keyof typeof PROVIDER_LOGOS]>)[id];
    expect(def).toBeDefined();
    expect(def!.viewBox).toBe('0 0 24 24');
    expect(def!.paths.length).toBeGreaterThan(0);
    expect(def!.source).toBeTruthy();
    expect(def!.license).toMatch(/^(CC0-1\.0|MIT)$/);
  });

  it('gives an unknown provider the neutral mark', () => {
    expect(providerLogo('someone-else')).toBe(GENERIC_PROVIDER_LOGO);
    expect(providerLogo(undefined)).toBe(GENERIC_PROVIDER_LOGO);
  });
});

describe('ProviderLogo', () => {
  it('colour variant: brand colour where the brand has one, text colour otherwise', () => {
    const { container } = render(
      <>
        <ProviderLogo provider="claude-agent" />
        <ProviderLogo provider="codex" />
        <ProviderLogo provider="claude-agent" variant="mono" />
      </>,
    );
    const [claude, codex, mono] = [...container.querySelectorAll('svg')];
    expect(claude!.getAttribute('fill')).toBe(PROVIDER_LOGOS['claude-agent'].brandColor);
    expect(codex!.getAttribute('fill')).toBe('currentColor');
    expect(mono!.getAttribute('fill')).toBe('currentColor');
  });

  it('is decorative by default and an image when labelled', () => {
    const { container } = render(
      <>
        <ProviderLogo provider="copilot" />
        <ProviderLogo provider="copilot" label />
        <ProviderLogo provider="codex" label="Codex provider" />
      </>,
    );
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('img', { name: 'GitHub Copilot' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Codex provider' })).toBeTruthy();
  });
});

describe('ProviderLogo with a server-supplied mark (ACP-5)', () => {
  it('draws the nodes as SVG elements, nested groups included, in the text colour', () => {
    const { container } = render(
      <ProviderLogo
        provider="acp"
        mark={{
          viewBox: '0 0 16 16',
          nodes: [
            { tag: 'g', attrs: { transform: 'translate(1,1)', 'fill-rule': 'evenodd' }, children: [{ tag: 'circle', attrs: { cx: '7', cy: '7', r: '3' } }] },
            { tag: 'rect', attrs: { x: '1', y: '1', width: '4', height: '4', 'stroke-width': '1.5', stroke: 'currentColor', fill: 'none' } },
          ],
        }}
      />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg.getAttribute('fill')).toBe('currentColor');
    const g = svg.querySelector('g')!;
    expect(g.getAttribute('transform')).toBe('translate(1,1)');
    expect(g.getAttribute('fill-rule')).toBe('evenodd');
    expect(g.querySelector('circle')!.getAttribute('r')).toBe('3');
    expect(svg.querySelector('rect')!.getAttribute('stroke-width')).toBe('1.5');
  });

  it('renders only allow-listed tags, attributes and paint', () => {
    const hostile = {
      viewBox: '0 0 16 16',
      nodes: [
        { tag: 'script', attrs: {} },
        { tag: 'image', attrs: { href: 'https://example.com/x.png' } },
        { tag: 'path', attrs: { d: 'M0 0h4v4z', fill: 'url(#x)', onclick: 'alert(1)', style: 'color:red' } },
      ],
    };
    const { container } = render(<ProviderLogo provider="acp" mark={hostile as never} />);
    const svg = container.querySelector('svg')!;
    expect(svg.querySelector('script, image')).toBeNull();
    const path = svg.querySelector('path')!;
    expect(path.getAttribute('d')).toBe('M0 0h4v4z');
    expect(path.hasAttribute('fill')).toBe(false);
    expect(path.hasAttribute('onclick')).toBe(false);
    expect(path.hasAttribute('style')).toBe(false);
  });

  it('falls back to the registry mark without one', () => {
    const { container } = render(<ProviderLogo provider="acp" mark={undefined} />);
    expect(container.querySelector('path')!.getAttribute('d')).toBe(GENERIC_PROVIDER_LOGO.paths[0]!.d);
  });
});
