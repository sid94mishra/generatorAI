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
import { LABEL_MAX_SCALE, USE_NATIVE_TABS, tabBarMetrics, withAlpha } from '../navigation/tabsImplementation';
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

describe('tabBarMetrics', () => {
  it('ships the JS tab bar until native tabs are verified', () => {
    expect(USE_NATIVE_TABS).toBe(false);
  });

  it('uses each platform’s canonical height plus the bottom inset', () => {
    expect(tabBarMetrics('ios', 34).height).toBe(49 + 34);
    expect(tabBarMetrics('android', 0).height).toBe(80);
    expect(tabBarMetrics('web', 0).height).toBe(56);
  });

  it('never lets the label row overflow the bar', () => {
    // The web-preview clipping: the bar must be at least icon + label +
    // padding tall, and grow with the reading size rather than clip.
    for (const platform of ['ios', 'android', 'web'] as const) {
      for (const scale of [1, 1.2, 1.4]) {
        const m = tabBarMetrics(platform, 0, scale);
        expect(m.contentHeight).toBeGreaterThanOrEqual(m.iconSize + 2 + m.labelLineHeight + 8);
        expect(m.showLabel).toBe(true);
      }
    }
  });

  it('drops the label past the cap instead of wrapping it', () => {
    const m = tabBarMetrics('ios', 0, LABEL_MAX_SCALE + 0.1);
    expect(m.showLabel).toBe(false);
  });

  it('draws the active pill only on Android', () => {
    expect(tabBarMetrics('android', 0).activePill).toBe(true);
    expect(tabBarMetrics('ios', 0).activePill).toBe(false);
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
    expect(resolveWorkSegment(['scripts', 'runs'], undefined)).toBe('scripts');
  });

  it('exposes four segments and a stable pref key', () => {
    expect(WORK_SEGMENTS).toEqual(['workflows', 'runs', 'automations', 'scripts']);
    expect(WORK_SEGMENT_PREF_KEY).toBe('work.segment');
  });
});

describe('scope requests', () => {
  it('lists only grantable scopes the device lacks, with what they unlock', () => {
    const missing = missingGrantableScopes(['read:chats', 'write:chats']);
    const scopes = missing.map((m) => m.scope);
    expect(scopes).toContain('exec:terminal');
    expect(scopes).toContain('write:workflows');
    // `projectEdit` is structurally impossible on a phone: never requestable.
    expect(scopes).not.toContain('write:projects');
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
