// How the dictation AudioWorklet reaches the browser.
//
// This is a source-level guard rather than a behavioural one because the
// failure it pins is invisible to every other kind of test: the worklet used
// to be built at runtime as a `blob:` URL, which works perfectly in the Vite
// dev server and is refused by the browser everywhere the app ships with its
// real Content-Security-Policy (`script-src 'self' '<hash>'` — no `blob:`, no
// `data:`). Voice input failed with "Failed to initialise audio: Unable to
// load a worklet's module" in the desktop app and in any production serve,
// and no unit test noticed because the policy is a response header.
//
// So the two rules are: load the processor from a real same-origin asset, and
// never re-introduce a runtime-constructed script URL for it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const hookSrc = readFileSync(join(here, '..', 'hooks', 'useSpeechToText.ts'), 'utf8');
const workletSrc = readFileSync(join(here, '..', 'audio', 'pcm-worklet.js'), 'utf8');
const viteConfig = readFileSync(join(here, '..', '..', 'vite.config.ts'), 'utf8');

describe('dictation AudioWorklet delivery', () => {
  it('loads the processor from an imported asset URL', () => {
    expect(hookSrc).toContain("from '../audio/pcm-worklet.js?url'");
    expect(hookSrc).toContain('audioWorklet.addModule(pcmWorkletUrl)');
  });

  it('never builds the worklet URL at runtime', () => {
    // `blob:` and `data:` script URLs are both outside `script-src 'self'`.
    expect(hookSrc).not.toContain('createObjectURL');
    expect(hookSrc).not.toMatch(/new Blob\(/);
  });

  it('keeps the worklet out of Vite’s small-asset inlining', () => {
    // Under the default 4KB threshold Vite turns a `?url` import into a
    // `data:` URI, which the CSP refuses exactly like the `blob:` it replaced.
    expect(viteConfig).toContain('assetsInlineLimit');
    expect(viteConfig).toContain('pcm-worklet.js');
  });

  it('registers the processor name the hook instantiates', () => {
    expect(workletSrc).toContain("registerProcessor('pcm-worklet'");
    expect(hookSrc).toContain("new AudioWorkletNode(ctx, 'pcm-worklet'");
  });

  it('takes its frame size from the hook rather than duplicating the constant', () => {
    expect(hookSrc).toContain('processorOptions: { frameSamples: FRAME_SAMPLES }');
    expect(workletSrc).toContain('processorOptions.frameSamples');
  });
});
