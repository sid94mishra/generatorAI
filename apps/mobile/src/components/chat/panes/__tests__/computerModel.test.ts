import { describe, expect, it } from 'vitest';

import { activeConsent, activityRows, consentOptions, secondsLeft, tookScreen } from '../computerModel';

const consent = (over: Partial<Parameters<typeof consentOptions>[0] & { expiresAt: number; requestId: string }> = {}) => ({
  requestId: 'r1',
  appIdentity: 'com.app',
  appLabel: 'App',
  action: 'click',
  summary: '',
  path: 'uia',
  expiresAt: 10_000,
  ...over,
});

describe('computerModel', () => {
  it('flags the tiers that take over the screen', () => {
    expect(tookScreen('synthetic')).toBe(true);
    expect(tookScreen('clipboard')).toBe(true);
    expect(tookScreen('uia')).toBe(false);
    expect(tookScreen(null)).toBe(false);
  });

  it('shows the oldest unexpired prompt', () => {
    const a = consent({ requestId: 'a', expiresAt: 5_000 });
    const b = consent({ requestId: 'b', expiresAt: 3_000 });
    const gone = consent({ requestId: 'c', expiresAt: 500 });
    expect(activeConsent([a, b, gone], 1_000)?.requestId).toBe('b');
    expect(activeConsent([gone], 1_000)).toBeNull();
    expect(activeConsent(undefined)).toBeNull();
    expect(secondsLeft(a, 1_001)).toBe(4);
    expect(secondsLeft(gone, 1_000)).toBe(0);
  });

  it('withholds "always allow" for synthetic input and never steps up a denial', () => {
    expect(consentOptions({ path: 'uia' }).map((o) => o.decision)).toEqual(['allow_once', 'allow_run', 'always_allow', 'deny']);
    expect(consentOptions({ path: 'synthetic' }).map((o) => o.decision)).toEqual(['allow_once', 'allow_run', 'deny']);
    const deny = consentOptions({ path: 'uia' }).find((o) => o.decision === 'deny');
    expect(deny).toMatchObject({ needsStepUp: false, tone: 'danger' });
    expect(consentOptions({ path: 'uia' }).filter((o) => o.decision !== 'deny').every((o) => o.needsStepUp)).toBe(true);
  });

  it('lists activity newest first with readable titles and tones', () => {
    const rows = activityRows([
      { action: 'computer_snapshot', appLabel: 'Notes', target: null, path: null, refusalCode: null, artifactId: 'f1', createdAt: '1' },
      { action: 'computer_type_text', appLabel: 'Notes', target: 'Body', path: 'synthetic', refusalCode: null, artifactId: null, createdAt: '2' },
      { action: 'click', appLabel: '', target: null, path: null, refusalCode: 'DENIED', artifactId: null, createdAt: '3' },
    ]);
    expect(rows.map((r) => r.title)).toEqual(['Click · desktop', 'Type text · Notes', 'Snapshot · Notes']);
    expect(rows[0]).toMatchObject({ tone: 'danger', subtitle: 'refused: DENIED' });
    expect(rows[1]).toMatchObject({ tone: 'warning', subtitle: 'Body · took over keyboard and mouse' });
    expect(rows[2]).toMatchObject({ tone: 'neutral', subtitle: null, artifactId: 'f1' });
    expect(activityRows(undefined)).toEqual([]);
    expect(activityRows(Array.from({ length: 50 }, (_, i) => ({ action: 'a', appLabel: 'x', target: null, path: null, refusalCode: null, artifactId: null, createdAt: String(i) })), 10)).toHaveLength(10);
  });
});
