import { describe, expect, it } from 'vitest';
import { DEFAULT_MOBILE_SCOPES, SCOPES } from '@generatorai/auth';

import {
  FEATURE_REQUIREMENTS,
  checkFeature,
  grantableFeatures,
  canRequestFeature,
  isFeatureAvailable,
  isScopeRequestable,
  type MobileFeature,
} from '../auth/featureGate';

const MOBILE = DEFAULT_MOBILE_SCOPES;
const ALL_FEATURES = Object.keys(FEATURE_REQUIREMENTS) as MobileFeature[];

describe('feature gate — default mobile device', () => {
  it('withholds terminal and browser', () => {
    // Asserted independently of the route policy so a scope-list edit cannot
    // quietly hand a phone the ability to run shell commands.
    expect(isFeatureAvailable('terminal', MOBILE)).toBe(false);
    expect(isFeatureAvailable('browser', MOBILE)).toBe(false);
    expect(isFeatureAvailable('computer', MOBILE)).toBe(false);
  });

  it('withholds every write capability beyond chat and review', () => {
    for (const feature of [
      'fileUpload',
      'scriptRun',
      'runControl',
      'workflowEdit',
      'projectEdit',
      'codebaseLinkLocal',
      'capabilityAdmin',
      'deviceAdmin',
    ] as const) {
      expect(isFeatureAvailable(feature, MOBILE), feature).toBe(false);
    }
  });

  it('allows voice, because sending messages is the point of the app', () => {
    expect(isFeatureAvailable('voice', MOBILE)).toBe(true);
  });
});

describe('feature gate — explanations', () => {
  it('gives a reason for every unavailable feature', () => {
    // "The terminal is broken" is what a user concludes from a tab that
    // opens and then fails silently.
    for (const feature of ALL_FEATURES) {
      const check = checkFeature(feature, []);
      expect(check.available).toBe(false);
      expect(check.reason, feature).toBeTruthy();
      expect(check.reason!.length, feature).toBeGreaterThan(20);
    }
  });

  it('writes reasons in plain language, not scope ids', () => {
    for (const feature of ALL_FEATURES) {
      const reason = checkFeature(feature, []).reason!;
      expect(reason, feature).not.toMatch(/\b(exec|read|write|admin):/);
    }
  });

  it('reports exactly which scopes are missing', () => {
    expect(checkFeature('terminal', MOBILE).missing).toEqual(['exec:terminal']);
    expect(checkFeature('terminal', [...MOBILE, 'exec:terminal']).missing).toEqual([]);
  });

  it('gates run control on BOTH scopes the run routes require', () => {
    // `/workflow-runs` writes need write:workflows + exec:agent; a device with
    // only the first would see Cancel/Retry buttons that 403.
    expect(isFeatureAvailable('runControl', ['write:workflows'])).toBe(false);
    expect(checkFeature('runControl', ['write:workflows']).missing).toEqual(['exec:agent']);
    expect(isFeatureAvailable('runControl', [...MOBILE, 'write:workflows'])).toBe(true);
  });

  it('explains that run control is separate from approving a gate', () => {
    // This is the distinction the route-policy fix encodes; if the UI does
    // not say it, a user assumes the approve button will also fail.
    expect(checkFeature('runControl', MOBILE).reason).toMatch(/[Aa]pproving/);
  });
});

describe('feature gate — grantability', () => {
  it('marks host-filesystem features as NOT grantable', () => {
    // A phone cannot pick a path on the machine running the server, so no
    // permission would make this work. Offering to request it is a lie.
    expect(checkFeature('codebaseLinkLocal', MOBILE).grantable).toBe(false);
    expect(grantableFeatures(MOBILE)).not.toContain('codebaseLinkLocal');
  });

  it('keeps local linking structural even once the scope is held', () => {
    // The scope makes the server accept the call; it does not give the phone
    // a way to browse host paths. The UI must still not offer a folder picker.
    const withScope = [...MOBILE, 'write:projects'];
    expect(checkFeature('codebaseLinkLocal', withScope).grantable).toBe(false);
    expect(grantableFeatures(withScope)).not.toContain('codebaseLinkLocal');
  });

  it('makes project editing grantable through write:projects', () => {
    expect(checkFeature('projectEdit', MOBILE)).toMatchObject({
      available: false,
      grantable: true,
      missing: ['write:projects'],
    });
    expect(isFeatureAvailable('projectEdit', [...MOBILE, 'write:projects'])).toBe(true);
  });

  it('gates capability administration on admin:settings', () => {
    expect(checkFeature('capabilityAdmin', MOBILE).missing).toEqual(['admin:settings']);
    expect(isFeatureAvailable('capabilityAdmin', [...MOBILE, 'admin:settings'])).toBe(true);
  });

  it('lists exactly the features worth asking for', () => {
    expect(grantableFeatures(MOBILE).sort()).toEqual(
      [
        'browser',
        'capabilityAdmin',
        'computer',
        'deviceAdmin',
        'fileUpload',
        'projectEdit',
        'runControl',
        'scriptRun',
        'terminal',
        'workflowEdit',
      ].sort(),
    );
  });

  it('drops a feature from the list once granted', () => {
    expect(grantableFeatures([...MOBILE, 'exec:terminal'])).not.toContain('terminal');
  });
});

describe('feature gate — requesting from the device', () => {
  it('lets a device request exec:computer', () => {
    expect(checkFeature('computer', MOBILE).missing).toEqual(['exec:computer']);
    expect(canRequestFeature('computer', MOBILE)).toBe(true);
    expect(isFeatureAvailable('computer', [...MOBILE, 'exec:computer'])).toBe(true);
  });

  it('mirrors the server: admin:* is only requestable by a device that already holds an admin scope', () => {
    expect(isScopeRequestable('admin:settings', MOBILE)).toBe(false);
    expect(isScopeRequestable('admin:settings', [...MOBILE, 'admin:devices'])).toBe(true);
    expect(isScopeRequestable('write:projects', MOBILE)).toBe(true);
    expect(canRequestFeature('capabilityAdmin', MOBILE)).toBe(false);
    expect(canRequestFeature('capabilityAdmin', [...MOBILE, 'admin:devices'])).toBe(true);
  });

  it('never offers a request for a structural or already-available feature', () => {
    expect(canRequestFeature('codebaseLinkLocal', MOBILE)).toBe(false);
    expect(canRequestFeature('voice', MOBILE)).toBe(false);
  });
});

describe('feature gate — integrity', () => {
  it('only requires scopes the server actually defines', () => {
    // A typo'd scope is permanently unsatisfiable, so the feature would be
    // dead with no way for a user to enable it.
    const known = new Set<string>(SCOPES);
    for (const [feature, requirement] of Object.entries(FEATURE_REQUIREMENTS)) {
      for (const scope of requirement.scopes) {
        expect(known.has(scope), `${feature} requires unknown scope "${scope}"`).toBe(true);
      }
    }
  });

  it('requires at least one scope per feature', () => {
    // An empty requirement silently means "always available".
    for (const [feature, requirement] of Object.entries(FEATURE_REQUIREMENTS)) {
      expect(requirement.scopes.length, feature).toBeGreaterThan(0);
    }
  });

  it('unlocks a feature when every required scope is present', () => {
    for (const feature of ALL_FEATURES) {
      const requirement = FEATURE_REQUIREMENTS[feature];
      expect(isFeatureAvailable(feature, requirement.scopes), feature).toBe(true);
    }
  });

  it('does not unlock on a partial grant', () => {
    // All-or-nothing matches the server's `hasAllScopes` check exactly.
    const multi: MobileFeature[] = ALL_FEATURES.filter(
      (f) => FEATURE_REQUIREMENTS[f].scopes.length > 1,
    );
    for (const feature of multi) {
      const partial = FEATURE_REQUIREMENTS[feature].scopes.slice(0, -1);
      expect(isFeatureAvailable(feature, partial), feature).toBe(false);
    }
  });
});
