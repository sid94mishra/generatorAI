import { describe, expect, it } from 'vitest';

import {
  APPROVALS_ROUTE,
  SCOPE_REQUEST_ROUTE,
  chatRoute,
  gateRoute,
  needsYouLabel,
  planRoute,
  runRoute,
} from '../navigation/routes';
import {
  FAB_MARGIN,
  FAB_SIZE,
  shellContentInsets,
  withAlpha,
} from '../navigation/tabsImplementation';
import {
  SHELL_SECTIONS,
  drawerAvailable,
  isShellRoot,
  sectionForPath,
} from '../navigation/shell/sections';
import { settleOpen, sidePanelWidth, SIDE_PANEL_MAX_WIDTH } from '../components/ui/sidePanelMath';
import {
  DEFAULT_WORK_SEGMENT,
  WORK_SEGMENTS,
  WORK_SEGMENT_PREF_KEY,
  resolveWorkSegment,
} from '../components/work/workSegment';
import { missingGrantableScopes, scopeRequestBody, scopeRequestOutcome } from '../auth/scopeRequests';

describe('route grammar', () => {
  it('matches the paths push notifications carry', () => {
    // These strings are the contract with the server's push payload
    // builder; the route files must exist at exactly these paths.
    expect(gateRoute('c1', 'i9')).toBe('/chats/c1/gate/i9');
    expect(planRoute('c1', 'p2')).toBe('/chats/c1/plan/p2');
    expect(chatRoute('c1')).toBe('/chats/c1');
    expect(runRoute('r3')).toBe('/runs/r3');
    expect(APPROVALS_ROUTE).toBe('/approvals');
    expect(SCOPE_REQUEST_ROUTE).toBe('/scope-request');
  });

  it('escapes ids that would otherwise break the path', () => {
    expect(gateRoute('a/b', 'x y')).toBe('/chats/a%2Fb/gate/x%20y');
  });
});

describe('needsYouLabel', () => {
  it('is null when nothing is waiting so the strip animates out', () => {
    expect(needsYouLabel(0)).toBeNull();
    expect(needsYouLabel(-1)).toBeNull();
    expect(needsYouLabel(Number.NaN)).toBeNull();
  });

  it('pluralises and caps', () => {
    expect(needsYouLabel(1)).toBe('1 waiting for you');
    expect(needsYouLabel(2)).toBe('2 waiting for you');
    expect(needsYouLabel(150)).toBe('99+ waiting for you');
  });
});

describe('shellContentInsets', () => {
  it('reserves nothing for a bar: the drawer replaced it', () => {
    expect(shellContentInsets(34).barOverlap).toBe(0);
  });

  it('floats the FAB a margin above the system inset', () => {
    expect(shellContentInsets(34).fabBottom).toBe(34 + FAB_MARGIN);
    expect(shellContentInsets(0).fabBottom).toBe(FAB_MARGIN);
    expect(shellContentInsets(-5).fabBottom).toBe(FAB_MARGIN);
  });

  it('pads a list so its last row clears the FAB entirely', () => {
    const insets = shellContentInsets(24);
    expect(insets.listBottom(true)).toBeGreaterThanOrEqual(insets.fabBottom + FAB_SIZE);
    expect(insets.listBottom(false)).toBeGreaterThan(24);
    expect(insets.listBottom(false)).toBeLessThan(insets.listBottom(true));
  });
});

describe('navigation drawer sections', () => {
  const segments = { work: 'workflows', projects: 'projects' } as const;

  it('lists exactly the desktop sidebar, in its order, with no Runs destination', () => {
    expect(SHELL_SECTIONS.map((s) => s.id)).toEqual([
      'home', 'projects', 'chats', 'agents', 'workflows', 'scripts', 'automations',
    ]);
  });

  it('lights the catalogue a detail route belongs to', () => {
    expect(sectionForPath('/', segments)).toBe('home');
    expect(sectionForPath('/chats/abc', segments)).toBe('chats');
    // A run belongs to its workflow, as on desktop.
    expect(sectionForPath('/runs/r1/stages/s1', segments)).toBe('workflows');
    expect(sectionForPath('/workflows/w1', segments)).toBe('workflows');
    expect(sectionForPath('/automations/a1', segments)).toBe('automations');
    expect(sectionForPath('/scripts/s1', segments)).toBe('scripts');
    expect(sectionForPath('/projects/p1/codebases/c1', segments)).toBe('projects');
  });

  it('defers to the reported segment on the shared roots', () => {
    expect(sectionForPath('/runs', { work: 'automations', projects: 'projects' })).toBe('automations');
    expect(sectionForPath('/projects', { work: 'workflows', projects: 'agents' })).toBe('agents');
  });

  it('lights nothing outside the shell', () => {
    expect(sectionForPath('/settings/appearance', segments)).toBeNull();
    expect(sectionForPath('/search', segments)).toBeNull();
  });

  it('offers the drawer on the roots only; a chat has Back like other pushed screens', () => {
    for (const path of ['/', '/chats', '/runs', '/projects']) {
      expect(drawerAvailable(path)).toBe(true);
    }
    for (const path of ['/chats/c1', '/pair', '/settings', '/chats/c1/plan/p1', '/projects/p1', '/runs/r1', '/runs/r1/stages/s1']) {
      expect(drawerAvailable(path)).toBe(false);
    }
    expect(isShellRoot('/chats/c1')).toBe(false);
  });
});

describe('side panel geometry', () => {
  it('leaves a strip of content visible on a narrow phone', () => {
    expect(sidePanelWidth(320)).toBeLessThan(320);
    expect(sidePanelWidth(1024)).toBe(SIDE_PANEL_MAX_WIDTH);
  });

  it('lets a flick beat position when a drag is released', () => {
    expect(settleOpen(0.1, 900)).toBe(true);
    expect(settleOpen(0.9, -900)).toBe(false);
    expect(settleOpen(0.6, 0)).toBe(true);
    expect(settleOpen(0.4, 0)).toBe(false);
  });
});

describe('withAlpha', () => {
  it('tints a hex token and leaves anything else alone', () => {
    expect(withAlpha('#161b22', 0.94)).toBe('rgba(22, 27, 34, 0.94)');
    expect(withAlpha('rgba(1,2,3,0.5)', 0.94)).toBe('rgba(1,2,3,0.5)');
    expect(withAlpha('#161b22', 2)).toBe('rgba(22, 27, 34, 1)');
  });
});

describe('resolveWorkSegment', () => {
  it('prefers the route param, then the stored value, then the default', () => {
    expect(resolveWorkSegment('workflows', 'runs')).toBe('workflows');
    expect(resolveWorkSegment(undefined, 'automations')).toBe('automations');
    expect(resolveWorkSegment(undefined, undefined)).toBe(DEFAULT_WORK_SEGMENT);
  });

  it('ignores anything unrecognised rather than throwing', () => {
    expect(resolveWorkSegment('nope', 'nah')).toBe(DEFAULT_WORK_SEGMENT);
    expect(resolveWorkSegment(['automations', 'runs'], undefined)).toBe('automations');
  });

  it('exposes the desktop catalogues — no Runs — and a stable pref key', () => {
    expect(WORK_SEGMENTS).toEqual(['workflows', 'scripts', 'automations']);
    expect(WORK_SEGMENT_PREF_KEY).toBe('work.segment');
  });

  it('lands an old Runs link or stored preference on Workflows, where runs now live', () => {
    expect(resolveWorkSegment('runs', undefined)).toBe('workflows');
    expect(resolveWorkSegment('runs', 'scripts')).toBe('workflows');
    expect(resolveWorkSegment(undefined, 'runs')).toBe('workflows');
    expect(DEFAULT_WORK_SEGMENT).toBe('workflows');
  });

  it('restores a phone left on the scripts segment now that it lists real scripts', () => {
    expect(resolveWorkSegment(undefined, 'scripts')).toBe('scripts');
    expect(resolveWorkSegment('scripts', 'runs')).toBe('scripts');
  });
});

describe('scope requests', () => {
  it('lists only grantable scopes the device lacks, with what they unlock', () => {
    const missing = missingGrantableScopes(['read:chats', 'write:chats']);
    const scopes = missing.map((m) => m.scope);
    expect(scopes).toContain('exec:terminal');
    expect(scopes).toContain('write:workflows');
    // `write:projects` is requestable for project editing, but the structural
    // `codebaseLinkLocal` (host folder picking) never rides along with it.
    expect(missing.find((m) => m.scope === 'write:projects')?.features).toEqual(['projectEdit']);
    expect(missing.find((m) => m.scope === 'write:workflows')?.features.sort()).toEqual(
      ['runControl', 'workflowEdit'],
    );
  });

  it('builds the exact body the server route accepts', () => {
    expect(scopeRequestBody(['exec:terminal', 'exec:terminal', ''], '  tests  ')).toEqual({
      scopes: ['exec:terminal'],
      reason: 'tests',
    });
    expect(scopeRequestBody(['exec:browser'], '   ')).toEqual({ scopes: ['exec:browser'] });
    expect(scopeRequestBody([], 'why')).toBeNull();
  });

  it('maps a 404 to “server needs an update”, not to a failure', () => {
    expect(scopeRequestOutcome(201)).toEqual({ kind: 'sent' });
    expect(scopeRequestOutcome(404)).toEqual({ kind: 'unsupported' });
    expect(scopeRequestOutcome(403)).toEqual({ kind: 'forbidden' });
    expect(scopeRequestOutcome(409)).toEqual({ kind: 'pending' });
    expect(scopeRequestOutcome(500)).toEqual({ kind: 'failed', status: 500 });
  });
});
