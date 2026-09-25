import { describe, expect, it } from 'vitest';
import {
  FOUNDATION_ICON_CONCEPTS,
  ICON,
  ICON_CONCEPTS,
  STATUS_ICON_CONCEPTS,
  isIconConcept,
  lucideName,
  type IconConcept,
} from '../icons.js';

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe('ICON_CONCEPTS (D-17, 02 §9)', () => {
  it('has the 48 Foundations concepts', () => {
    expect(FOUNDATION_ICON_CONCEPTS).toHaveLength(48);
    expect(FOUNDATION_ICON_CONCEPTS.slice(0, 7)).toEqual([
      'home',
      'chats',
      'projects',
      'agents',
      'workflows',
      'automations',
      'scripts',
    ]);
  });

  it('has one glyph per status state', () => {
    expect(STATUS_ICON_CONCEPTS).toEqual([
      'status-queued',
      'status-running',
      'status-waiting',
      'status-needs-you',
      'status-paused',
      'status-succeeded',
      'status-failed',
      'status-skipped',
    ]);
    expect(lucideName('status-running')).toBe('loader-circle');
    expect(lucideName('status-needs-you')).toBe('hand');
  });

  it('includes the board UI glyphs', () => {
    for (const c of ['chevron-down', 'sidebar', 'dock', 'maximize', 'mode-light', 'mode-dark', 'mode-system'] as const) {
      expect(isIconConcept(c)).toBe(true);
    }
    expect(Object.keys(ICON_CONCEPTS).length).toBeGreaterThanOrEqual(48 + 8 + 50);
  });

  it('uses kebab-case lucide 1.x names and empty mobile slots', () => {
    for (const [concept, def] of Object.entries(ICON_CONCEPTS) as Array<[IconConcept, (typeof ICON_CONCEPTS)[IconConcept]]>) {
      expect(def.lucide, concept).toMatch(KEBAB);
      expect(Object.keys(def), concept).toEqual(['lucide']);
    }
    // The three lucide 1.x renames (canonical names, not the deprecated aliases).
    expect(lucideName('scripts')).toBe('file-code-corner');
    expect(lucideName('trash')).toBe('trash');
    expect(lucideName('history')).toBe('rotate-ccw-clock');
  });

  it('has the Spinner loader concept', () => {
    expect(lucideName('loader')).toBe('loader-circle');
  });

  it('isIconConcept rejects non-concepts', () => {
    expect(isIconConcept('house')).toBe(false);
    expect(isIconConcept('toString')).toBe(false);
    expect(isIconConcept(42)).toBe(false);
  });

  it('ICON sizes and stroke', () => {
    expect(ICON).toEqual({ sizes: [12, 14, 16, 20], defaultSize: 16, strokeWidth: 1.75 });
  });
});
