// ────────────────────────────────────────────────────────────────
// Push-to-talk preference.
//
// Hold the mic to dictate, release to accept — instead of tap to start /
// tap to accept. Stored under the composer's own MMKV key because
// `src/prefs/preferences.tsx` (Settings → Accessibility) does not yet expose
// a voice section.
//
// TODO(prefs): move to `PreferencesValue` with a Settings → Audio toggle once
// that section exists; `readPushToTalk` is the only consumer to update.
// ────────────────────────────────────────────────────────────────

import { prefs } from '../storage/prefs';

export const PUSH_TO_TALK_KEY = 'composer.voice.pushToTalk';

export function readPushToTalk(): boolean {
  return prefs.getBoolean(PUSH_TO_TALK_KEY, false);
}

export function writePushToTalk(enabled: boolean): void {
  prefs.setBoolean(PUSH_TO_TALK_KEY, enabled);
}
