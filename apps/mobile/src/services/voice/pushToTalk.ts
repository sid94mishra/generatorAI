// ────────────────────────────────────────────────────────────────
// Push-to-talk preference.
//
// Hold the mic to dictate, release to accept — instead of tap to start /
// tap to accept. Stored under the composer's own MMKV key because
// `services/prefs/preferences.tsx` exposes no voice preference, and Settings › Audio (MSetAudio)
// draws no push-to-talk row — so nothing writes it yet (final review F-6).
//
// When a board adds the row: move it to `PreferencesValue`; `readPushToTalk` is the only consumer.
// ────────────────────────────────────────────────────────────────

import { prefs } from '../storage/prefs';

export const PUSH_TO_TALK_KEY = 'composer.voice.pushToTalk';

export function readPushToTalk(): boolean {
  return prefs.getBoolean(PUSH_TO_TALK_KEY, false);
}

export function writePushToTalk(enabled: boolean): void {
  prefs.setBoolean(PUSH_TO_TALK_KEY, enabled);
}
