// The icon registry (D-17, 02 §9): every ICON_CONCEPTS entry maps to the
// lucide-react 1.x component of exactly that name — a deprecated alias (trash-2,
// history, file-code-2 …) or a mismatched import fails through displayName —
// and the status map's glyphs (D-18) are all registered concepts.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ICON, ICON_CONCEPTS, isIconConcept, type IconConcept } from '@generatorai/design-tokens';
import { STATUS_STATES, STATUS_STATE_DEFS } from '@generatorai/shared';

import { Icon, ICON_REGISTRY } from '@/ui/icons/index.js';

const kebab = (pascal: string) => pascal.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Za-z])(\d)/g, '$1-$2').toLowerCase();

describe('ICON_REGISTRY', () => {
  it('maps exactly the ICON_CONCEPTS keys', () => {
    expect(Object.keys(ICON_REGISTRY).sort()).toEqual(Object.keys(ICON_CONCEPTS).sort());
  });

  it.each(Object.entries(ICON_CONCEPTS))('%s → lucide "%s"', (concept, def) => {
    const component = ICON_REGISTRY[concept as IconConcept];
    expect(component.displayName, concept).toBeDefined();
    expect(kebab(component.displayName!), concept).toBe(def.lucide);
  });
});

describe('status glyphs', () => {
  it.each(STATUS_STATES)('%s glyph is a registered concept', (state) => {
    expect(isIconConcept(STATUS_STATE_DEFS[state].glyph)).toBe(true);
  });
});

describe('<Icon>', () => {
  it('renders a decorative 16px glyph with stroke 1.75 by default', () => {
    const { container } = render(<Icon concept="changes" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe(String(ICON.defaultSize));
    expect(svg.getAttribute('height')).toBe(String(ICON.defaultSize));
    expect(svg.getAttribute('stroke-width')).toBe('1.75');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('data-icon')).toBe('changes');
    expect(svg.classList.contains('lucide-git-compare')).toBe(true);
  });

  it.each(ICON.sizes)('size %i', (size) => {
    const { container } = render(<Icon concept="plus" size={size} />);
    expect(container.querySelector('svg')!.getAttribute('width')).toBe(String(size));
  });

  it('a label makes it a named image and keeps the caller class', () => {
    const { getByRole } = render(<Icon concept="status-failed" label="Failed" className="text-err" />);
    const img = getByRole('img', { name: 'Failed' });
    expect(img.getAttribute('aria-hidden')).toBeNull();
    expect(img.classList.contains('text-err')).toBe(true);
  });

  it('the Spinner loader concept is the loader-circle glyph', () => {
    const { container } = render(<Icon concept="loader" />);
    expect(container.querySelector('svg')!.classList.contains('lucide-loader-circle')).toBe(true);
  });
});
