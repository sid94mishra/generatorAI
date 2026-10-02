import { describe, expect, it } from 'vitest';

import { SHELL_SECTIONS, drawerAvailable, sectionForPath } from '../navigation/shell/sections';
import { settleOpen, sidePanelWidth, SIDE_PANEL_MAX_WIDTH } from '../components/ui/sidePanelMath';
import {
  DEFAULT_WORK_SEGMENT,
  WORK_SEGMENTS,
  WORK_SEGMENT_PREF_KEY,
  resolveWorkSegment,
} from '../components/work/workSegment';
import { missingGrantableScopes, scopeRequestBody, scopeRequestOutcome } from '../services/auth/scopeRequests';

describe('navigation drawer sections', () => {
  it('lists the desktop sidebar destinations as module roots', () => {
    expect(SHELL_SECTIONS.map((s) => s.href)).toEqual(['/', '/projects', '/chats', '/agents', '/workflows', '/scripts', '/automations']);
  });

  it('lights the module of a detail route', () => {
    expect(sectionForPath('/')).toBe('home');
    expect(sectionForPath('/chats/abc')).toBe('chats');
    expect(sectionForPath('/workflows/w1/runs/r1/stages/s1')).toBe('workflows');
    expect(sectionForPath('/automations')).toBe('automations');
    expect(sectionForPath('/agents')).toBe('agents');
    expect(sectionForPath('/projects/p1/codebases/c1')).toBe('projects');
    expect(sectionForPath('/settings/appearance')).toBeNull();
    expect(sectionForPath('/search')).toBeNull();
  });

  it('offers the drawer on module roots only; a chat has Back like other pushed screens', () => {
    for (const path of ['/', '/chats', '/workflows', '/projects', '/agents', '/scripts', '/automations']) {
      expect(drawerAvailable(path)).toBe(true);
    }
    for (const path of ['/chats/c1', '/pair', '/settings', '/projects/p1', '/workflows/w1/runs/r1']) {
      expect(drawerAvailable(path)).toBe(false);
    }
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
      ['runControl', 'scriptRun', 'workflowEdit'],
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
