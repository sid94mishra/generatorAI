// ────────────────────────────────────────────────────────────────
// Audio session modes — the two states the app's audio can be in.
//
// iOS has ONE audio session per app, and whatever last configured it wins.
// Dictation needs `allowsRecording: true`, which puts the session in the
// `.playAndRecord` category: output then routes to the quiet receiver path
// and — once recording stops — read-aloud sounded silent or near-silent,
// and was muted outright by the ring/silent switch if the session had been
// reset. So each side sets its own mode before it starts:
//
//   PLAYBACK   read-aloud: plays with the silent switch on (the user asked
//              for speech; it is not an alert tone), no recording, ducks
//              music instead of stopping it, stops in the background.
//   RECORDING  dictation: records, still audible in silent mode.
//
// Android honours `playsInSilentMode`/`interruptionMode` (audio focus) and
// ignores the iOS-only fields, so the same objects are correct on both.
//
// Pure data, no Expo import, so the chosen values are pinned by a unit test.
// ────────────────────────────────────────────────────────────────

/** Structural subset of expo-audio's `AudioMode` this app sets. */
export interface AppAudioMode {
  playsInSilentMode: boolean;
  allowsRecording: boolean;
  interruptionMode: 'mixWithOthers' | 'doNotMix' | 'duckOthers';
  shouldPlayInBackground: boolean;
  shouldRouteThroughEarpiece: boolean;
}

export const PLAYBACK_AUDIO_MODE: AppAudioMode = {
  playsInSilentMode: true,
  allowsRecording: false,
  interruptionMode: 'duckOthers',
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
};

export const RECORDING_AUDIO_MODE: AppAudioMode = {
  playsInSilentMode: true,
  allowsRecording: true,
  interruptionMode: 'duckOthers',
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
};
