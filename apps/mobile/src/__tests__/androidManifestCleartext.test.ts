import { describe, expect, it } from 'vitest';
import { setUsesCleartextTraffic } from '../../plugins/androidManifestCleartext.js';

describe('withCleartextTraffic manifest transform', () => {
  it('sets android:usesCleartextTraffic="true" on <application>, keeping other attributes', () => {
    const manifest = {
      manifest: {
        application: [{ $: { 'android:name': '.MainApplication', 'android:allowBackup': 'false' } }],
      },
    };
    const out = setUsesCleartextTraffic(manifest);
    // `noUncheckedIndexedAccess` is on, so the element is `T | undefined`.
    // Asserting the array shape first keeps the failure message useful when
    // the transform drops the entry entirely.
    expect(out.manifest.application).toHaveLength(1);
    expect(out.manifest.application[0]?.$).toEqual({
      'android:name': '.MainApplication',
      'android:allowBackup': 'false',
      'android:usesCleartextTraffic': 'true',
    });
  });

  it('fails loudly on a manifest without <application> rather than silently shipping a blocked build', () => {
    expect(() => setUsesCleartextTraffic({ manifest: {} } as never)).toThrow(/<application>/);
  });
});
