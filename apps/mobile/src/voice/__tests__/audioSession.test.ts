import { describe, expect, it } from 'vitest';

import { PLAYBACK_AUDIO_MODE, RECORDING_AUDIO_MODE } from '../audioSession';

describe('audio session modes', () => {
  it('read-aloud plays through the silent switch on the speaker, without recording', () => {
    expect(PLAYBACK_AUDIO_MODE.playsInSilentMode).toBe(true);
    // `.playAndRecord` is what made read-aloud quiet after dictation.
    expect(PLAYBACK_AUDIO_MODE.allowsRecording).toBe(false);
    expect(PLAYBACK_AUDIO_MODE.shouldRouteThroughEarpiece).toBe(false);
    expect(PLAYBACK_AUDIO_MODE.interruptionMode).toBe('duckOthers');
    // No background audio mode is declared (app.config), so none is requested.
    expect(PLAYBACK_AUDIO_MODE.shouldPlayInBackground).toBe(false);
  });

  it('dictation records and stays audible in silent mode', () => {
    expect(RECORDING_AUDIO_MODE.allowsRecording).toBe(true);
    expect(RECORDING_AUDIO_MODE.playsInSilentMode).toBe(true);
    expect(RECORDING_AUDIO_MODE.shouldPlayInBackground).toBe(false);
  });
});
