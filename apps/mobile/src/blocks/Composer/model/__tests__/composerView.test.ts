import { describe, expect, it } from 'vitest';
import { composerLabel, composerPlaceholder, composerPrimary, plusMenu, suggestionGroups, suggestionTag } from '../composerView';

describe('Composer view model (MB-01)', () => {
  it('two-phase Stop (MD-03)', () => {
    expect(composerPrimary(false, undefined)).toBe('send');
    expect(composerPrimary(true, { label: 'Stop', enabled: true, forceAvailable: false })).toBe('stop');
    expect(composerPrimary(true, { label: 'Stopping…', enabled: false, forceAvailable: false })).toBe('stopping');
    expect(composerPrimary(true, { label: 'Force reset', enabled: true, forceAvailable: true })).toBe('force');
  });

  it('placeholder never says Queue (D-29)', () => {
    expect(composerPlaceholder({ disabled: false, gated: false, agent: 'Bug Fixer' })).toBe('Reply to Bug Fixer…');
    // Provider-neutral for a plain model chat (D-90).
    expect(composerPlaceholder({ disabled: false, gated: false })).toBe('Ask anything — / for skills');
    expect(composerPlaceholder({ disabled: false, gated: false, files: true })).toBe('Ask anything — @ for files, / for skills');
    expect(composerPlaceholder({ disabled: false, gated: false, orchestrator: true })).toBe('Reply to the orchestrator…');
    expect(composerPlaceholder({ disabled: true, gated: true, agent: 'Bug Fixer' })).toBe('Reply to Bug Fixer…');
    expect(composerPlaceholder({ disabled: true, gated: false, agent: 'Bug Fixer' })).toBe('Waiting…');
    expect(composerLabel(null)).toBe('Message');
    expect(composerLabel('Bug Fixer')).toBe('Message Bug Fixer');
  });

  it('"+" menu: captures only where they exist, disabled uploads with the reason (MD-63)', () => {
    const ids = (items: ReturnType<typeof plusMenu>) => items.map((i) => ('type' in i ? '|' : i.id));
    const all = plusMenu({ attachAvailable: true, browser: true, terminal: true, terminalSelection: null, history: true });
    expect(ids(all)).toEqual(['file', 'photo', 'camera', '|', 'browser', 'terminal', 'clipboard', '|', 'slash', 'mention', '|', 'history']);
    const off = plusMenu({ attachAvailable: false, attachDisabledReason: 'No upload scope', browser: false, terminal: false, terminalSelection: null, history: false });
    expect(ids(off)).toEqual(['file', 'photo', 'camera', '|', 'clipboard', 'request-access', '|', 'slash', 'mention']);
    const file = off[0] as Extract<(typeof off)[number], { id: string }>;
    expect(file).toMatchObject({ disabled: true, subtitle: 'No upload scope' });
    expect(all.some((i) => !('type' in i) && i.label === 'Commands & skills')).toBe(true);
  });

  it('groups suggestions Tools · Skills · Prompts', () => {
    const groups = suggestionGroups([
      { id: 's', name: 'triage', label: '/triage', kind: 'skill', source: 'system' },
      { id: 'b', name: 'browser', label: '/browser', kind: 'navigate', source: 'builtin' },
      { id: 'p', name: 'notes', label: '/notes', kind: 'prompt', source: 'project' },
    ]);
    expect(groups.map((g) => g.title)).toEqual(['Tools', 'Skills', 'Prompts']);
    expect(suggestionTag(groups[0]!.items[0]!)).toBe('tool');
  });
});
