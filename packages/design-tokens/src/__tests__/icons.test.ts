import { describe, expect, it } from 'vitest';
import {
  FOUNDATION_ICON_CONCEPTS,
  ICON,
  ICON_CONCEPTS,
  MOBILE_ICON_CONCEPTS,
  mobileIconDef,
  type IconConceptDef,
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

  it('uses kebab-case lucide 1.x names', () => {
    for (const [concept, def] of Object.entries(ICON_CONCEPTS) as Array<[IconConcept, (typeof ICON_CONCEPTS)[IconConcept]]>) {
      expect(def.lucide, concept).toMatch(KEBAB);
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

// Mobile registry (mobile 02 §5.4): SF Symbol / Material Symbol per concept, or lucideOnly.
describe('mobile icon registry (02 §5.4)', () => {
  const all = Object.entries({ ...ICON_CONCEPTS, ...MOBILE_ICON_CONCEPTS }) as Array<[string, IconConceptDef]>;
  const SF = /^[a-z0-9]+(\.[a-z0-9]+)*$/;
  const MATERIAL = /^[a-z0-9_]+$/;

  it.each(all)('%s is either lucideOnly or has both native names', (_concept, def) => {
    if (def.lucideOnly) {
      expect(def.lucideOnly).toBe(true);
      for (const k of ['sfSymbol', 'material', 'sfSymbolFill', 'materialFill'] as const) expect(def[k]).toBeUndefined();
    } else {
      expect(def.sfSymbol).toMatch(SF);
      expect(def.material).toMatch(MATERIAL);
    }
    if (def.sfSymbolFill !== undefined) {
      expect(def.sfSymbolFill).toMatch(SF);
      expect(def.sfSymbolFill.endsWith('.fill')).toBe(true);
    }
    if (def.materialFill !== undefined) expect(def.material).toBeDefined();
  });

  it('keeps the lucideOnly set exactly (a change is a deliberate edit here)', () => {
    expect(all.filter(([, d]) => d.lucideOnly).map(([c]) => c).sort()).toEqual(
      ['agents', 'branch', 'changes', 'commit', 'diff', 'hook', 'pr', 'variable', 'webhook'].sort(),
    );
  });

  it('shares a native glyph only between the whitelisted pairs', () => {
    const allowed = new Set([
      'sf:folder:folder-open,projects',
      'sf:clock:clock,status-waiting',
      'material:schedule:clock,status-waiting',
      'sf:hand.raised:hand,status-needs-you',
      'material:back_hand:hand,status-needs-you',
      'sf:progress.indicator:loader,status-running',
      'material:progress_activity:loader,status-running',
      'sf:ellipsis:more,more-vertical',
    ]);
    const owners = new Map<string, string[]>();
    for (const [concept, def] of all) {
      for (const [kind, name] of [['sf', def.sfSymbol], ['sf', def.sfSymbolFill], ['material', def.material]] as const) {
        if (!name) continue;
        const key = `${kind}:${name}`;
        owners.set(key, [...(owners.get(key) ?? []), concept]);
      }
    }
    const shared = [...owners].filter(([, cs]) => cs.length > 1).map(([key, cs]) => `${key}:${cs.sort().join(',')}`);
    expect(shared.sort()).toEqual([...allowed].sort());
  });

  it('keeps mobile-only concepts out of ICON_CONCEPTS and resolves every concept', () => {
    for (const key of Object.keys(MOBILE_ICON_CONCEPTS)) expect(Object.keys(ICON_CONCEPTS)).not.toContain(key);
    expect(mobileIconDef('pin')).toMatchObject({ sfSymbolFill: 'pin.fill', material: 'keep', materialFill: true });
    expect(mobileIconDef('changes').lucideOnly).toBe(true);
  });

  it('fills exactly the concepts with a filled state', () => {
    expect(all.filter(([, d]) => d.materialFill).map(([c]) => c).sort()).toEqual(['pause', 'pin', 'play', 'stop']);
  });
});
