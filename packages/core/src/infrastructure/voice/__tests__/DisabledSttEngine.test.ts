// ────────────────────────────────────────────────────────────────
// DisabledSttEngine — trivially small, but the contract that matters is
// "never does real work": no throw, no network, resolves immediately.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { DisabledSttEngine } from '../DisabledSttEngine.js';

describe('DisabledSttEngine', () => {
  it('load() resolves immediately without throwing', async () => {
    const engine = new DisabledSttEngine();
    await expect(engine.load()).resolves.toBeUndefined();
  });

  it('transcribe() resolves to empty text regardless of input', async () => {
    const engine = new DisabledSttEngine();
    await expect(engine.transcribe(new Float32Array(16_000), { language: 'en' })).resolves.toEqual({ text: '' });
  });

  it('dispose() resolves immediately without throwing', async () => {
    const engine = new DisabledSttEngine();
    await expect(engine.dispose()).resolves.toBeUndefined();
  });

  it('is safe to call repeatedly (matches the port\'s "safe to call load() repeatedly" contract)', async () => {
    const engine = new DisabledSttEngine();
    await engine.load();
    await engine.load();
    await expect(engine.load()).resolves.toBeUndefined();
  });
});
