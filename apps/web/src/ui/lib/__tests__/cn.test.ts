// tailwind-merge conflict test (D-09, 09 §2.5, 02 §10.3). Merging is static
// (no theme or density input), so one run covers every theme and density.

import { describe, expect, it } from 'vitest';
import {
  COLOR_NAMES,
  CONTAINER_NAMES,
  HEIGHT_NAMES,
  RADIUS_STEPS,
  REQUIRED_UTILITIES,
  SIZE_NAMES,
  TEXT_STEPS,
  Z_NAMES,
} from '@generatorai/design-tokens';
import { cn } from '../cn';
import { cn as legacyCn } from '@/lib/utils';

describe('cn — the 09 §2.5 pairs', () => {
  it.each([
    [['text-fg-2', 'text-title'], 'text-fg-2 text-title'], // colour vs size: both kept
    [['text-ui', 'text-title'], 'text-title'],
    [['text-fg', 'text-fg-3'], 'text-fg-3'],
    [['text-micro', 'text-on-accent'], 'text-micro text-on-accent'],
    [['bg-surface', 'bg-raised'], 'bg-raised'],
    [['border-line', 'border-line-strong'], 'border-line-strong'],
    [['rounded-control', 'rounded-card'], 'rounded-card'],
    [['rounded-badge', 'rounded-full'], 'rounded-full'],
    [['shadow-pop', 'shadow-none'], 'shadow-none'],
    [['h-control', 'h-control-sm'], 'h-control-sm'],
    [['h-row', 'h-full'], 'h-full'],
    [['px-2', 'px-3'], 'px-3'], // defaults still merge
    [['text-run', 'text-ok'], 'text-ok'],
  ] as const)('cn(%j) → %s', (input, expected) => {
    expect(cn(...input)).toBe(expected);
  });
});

describe('cn — the 02 §10.3 extras', () => {
  it.each([
    [['text-fg', 'text-fg-2'], 'text-fg-2'],
    [['text-ui', 'text-body'], 'text-body'],
    [['h-row', 'h-8'], 'h-8'],
    [['size-control', 'size-4'], 'size-4'],
    [['z-dialog', 'z-tooltip'], 'z-tooltip'],
    [['border', 'border-line'], 'border border-line'], // width vs colour
    [['w-sidebar', 'w-rail'], 'w-rail'],
    [['max-w-dialog', 'max-w-dialog-lg'], 'max-w-dialog-lg'],
    [['min-h-row', 'min-h-0'], 'min-h-0'],
    [['ease-standard', 'ease-linear'], 'ease-linear'],
    [['bg-accent', 'bg-accent-tint'], 'bg-accent-tint'], // design vs legacy name, same group
    [['hover:bg-hover', 'hover:bg-selected'], 'hover:bg-selected'],
  ] as const)('cn(%j) → %s', (input, expected) => {
    expect(cn(...input)).toBe(expected);
  });
});

describe('cn — generated from the vocabulary', () => {
  it('drops nothing in REQUIRED_UTILITIES and recognises each (a duplicate collapses)', () => {
    for (const x of REQUIRED_UTILITIES) {
      expect(cn(x), x).toBe(x);
      // tailwind-merge only de-duplicates classes it can place in a group;
      // an unknown class survives twice.
      expect(cn(x, x), `${x} is not in a merge group`).toBe(x);
    }
  });

  it('within each namespace the later name wins', () => {
    const namespaces: Array<[string, readonly string[]]> = [
      ['bg', COLOR_NAMES],
      ['text', TEXT_STEPS],
      ['rounded', RADIUS_STEPS],
      ['h', HEIGHT_NAMES],
      ['min-h', HEIGHT_NAMES],
      ['max-h', HEIGHT_NAMES],
      ['size', SIZE_NAMES],
      ['z', Z_NAMES],
      ['w', CONTAINER_NAMES],
      ['max-w', CONTAINER_NAMES],
    ];
    for (const [prefix, names] of namespaces) {
      for (let i = 1; i < names.length; i += 1) {
        const [a, b] = [`${prefix}-${names[i - 1]}`, `${prefix}-${names[i]}`];
        expect(cn(a, b), `${a} ${b}`).toBe(b);
      }
    }
  });

  it('a type step never removes a text colour, and vice versa', () => {
    for (const step of TEXT_STEPS) {
      for (const color of COLOR_NAMES) {
        expect(cn(`text-${step}`, `text-${color}`)).toBe(`text-${step} text-${color}`);
        expect(cn(`text-${color}`, `text-${step}`)).toBe(`text-${color} text-${step}`);
      }
    }
  });

  it('the legacy lib/utils cn is the same function', () => {
    expect(legacyCn).toBe(cn);
  });
});
