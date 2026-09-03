// ────────────────────────────────────────────────────────────────
// W29 — the mobile half of the capability ledger's runtime proof.
//
// This suite is deliberately node-environment and does not render screens
// (see `vitest.config.ts`: a jsdom shim for React Native renders something
// that resembles the app without behaving like it, which is worse than no
// coverage because it passes when the real thing is broken). So the proof a
// mobile capability claim gets here is a proof about the WIRING: whether the
// call site that would have to exist for the capability to work does exist.
//
// That is a weaker guarantee than web's rendering probes and it is stated
// plainly rather than dressed up — but it is the guarantee that was missing.
// `MOBILE_CAPABILITIES.fileAttachment` was declared `enforced(true)` while
// mobile could not attach a file by any route: `Composer` accepts an optional
// `onAttach`, `app/chats/[id].tsx` never passes one, so the attach button fell
// through to `props.onAttach ?? (() => {})` and did nothing when tapped. No
// probe could catch that, because no probe named the mobile surface.
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { MOBILE_CAPABILITIES } from '@generatorai/shared';

/** apps/mobile/src/__tests__ → apps/mobile */
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const read = (rel: string): string => readFileSync(resolve(APP_ROOT, rel), 'utf8');

describe('W29 — mobile fileAttachment', () => {
  //   @capability-proof mobile/fileAttachment
  const chatScreen = read('app/chats/[id].tsx');
  const composer = read('src/components/chat/Composer.tsx');

  it('the composer only has an attach path when a handler is supplied', () => {
    // The control itself is real, which is what made the ledger's claim
    // plausible: there IS an "Add attachment" button. It is `onAttach` that
    // decides whether pressing it can do anything.
    expect(composer).toContain('accessibilityLabel="Add attachment"');
    expect(
      /onAttach\?:/.test(composer),
      'Composer no longer takes an optional onAttach — re-derive this probe',
    ).toBe(true);
    // The fallback is what turns a missing handler into a dead control rather
    // than a crash, so its presence is the mechanism this test is about.
    expect(composer).toContain('props.onAttach ?? (() => {})');
  });

  it('declares fileAttachment exactly when the chat screen wires an attach handler', () => {
    // The lock, in both directions. Wiring an attachment picker without
    // updating the ledger fails here; flipping the ledger without wiring one
    // fails here. Today neither is true and the expected value is `false`.
    const wired = /\bonAttach=/.test(chatScreen);

    expect(
      MOBILE_CAPABILITIES.fileAttachment.supported,
      wired
        ? 'app/chats/[id].tsx now passes onAttach, so mobile can attach — set ' +
          'MOBILE_CAPABILITIES.fileAttachment to supported.'
        : 'app/chats/[id].tsx passes no onAttach, so the attach button is inert — ' +
          'MOBILE_CAPABILITIES.fileAttachment must not claim the capability.',
    ).toBe(wired);
  });

  it('carries no attachments into a send while the capability is off', () => {
    // The second half of "cannot attach": even a wired button would need the
    // send path to carry files. The screen passes a literal empty list, so
    // there is nothing for a picker to feed.
    if (MOBILE_CAPABILITIES.fileAttachment.supported) return;
    expect(chatScreen).toContain('attachments={[]}');
  });
});
