import { describe, expect, it } from 'vitest';

import { engineLabel, parseAudioSettings, pauseLabel, pauseStops, speedLabel } from '../settings/audioModel';

describe('audio settings model', () => {
  it('names engines as desktop does and passes unknown ones through', () => {
    expect(engineLabel('auto')).toBe('Automatic (recommended)');
    expect(engineLabel('some-new-engine')).toBe('some-new-engine');
  });

  it('offers stops inside the server bounds only', () => {
    expect(pauseStops(500, 1500, 800)).toEqual([600, 800, 1000, 1200, 1500]);
  });

  it('keeps a value set from desktop selectable even when it is not a stop', () => {
    expect(pauseStops(300, 3000, 950)).toContain(950);
    expect(pauseStops(300, 3000, 950)).toEqual([...pauseStops(300, 3000, 950)].sort((a, b) => a - b));
    // Out of bounds is not offered.
    expect(pauseStops(300, 3000, 9999)).not.toContain(9999);
  });

  it('labels pauses and speeds compactly', () => {
    expect(pauseLabel(1000)).toBe('1s');
    expect(pauseLabel(800)).toBe('0.8s');
    expect(speedLabel(1)).toBe('1×');
    expect(speedLabel(1.25)).toBe('1.25×');
  });

  it('reads a full payload and survives an older, thinner one', () => {
    const full = parseAudioSettings({
      sttEngine: 'nemotron', textFormatter: 'none', endpointSilenceMs: 1200, ttsEnabled: false, ttsSpeed: 1.5,
      engines: ['auto', 'nemotron'], formatters: ['rule-based', 'none'], minEndpointMs: 300, maxEndpointMs: 5000,
      engineLockedByEnv: 'whisper',
    });
    expect(full).toMatchObject({ sttEngine: 'nemotron', ttsEnabled: false, engineLockedByEnv: 'whisper' });
    const thin = parseAudioSettings({});
    expect(thin).toMatchObject({ sttEngine: 'auto', engines: ['auto'], ttsEnabled: true, engineLockedByEnv: null });
    expect(parseAudioSettings(null)).toBeNull();
  });
});
