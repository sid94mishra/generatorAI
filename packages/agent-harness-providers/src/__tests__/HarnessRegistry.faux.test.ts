// ────────────────────────────────────────────────────────────────
// P2-00 — HarnessRegistry's synthetic 'faux' status.
//
// `GENERATORAI_TEST_FAUX_HARNESS` (renamed from the load-test-only
// `GENERATORAI_LOAD_TEST_FAUX_HARNESS`) makes the registry report a
// synthetic, always-ready 'faux' provider with a non-empty model catalog —
// restoring CI coverage of subsystems-live's "every ready provider
// publishes a non-empty model catalog" test (P0 review R15). Off by
// default: the registry must behave exactly as before when the flag is
// not passed.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { HarnessRegistry, ALL_HARNESS_TYPES } from '../HarnessRegistry.js';
import { FAUX_MODELS } from '../providers/faux/FauxProvider.js';

describe('HarnessRegistry — testFauxHarness (P2-00)', () => {
  it('reports no faux entry when testFauxHarness is not set (default off)', () => {
    const registry = new HarnessRegistry({ primary: 'copilot', buildConfig: (type) => ({ type }) });
    const statuses = registry.getStatuses();
    expect(statuses.some((s) => s.type === 'faux')).toBe(false);
    expect(registry.readyTypes).not.toContain('faux');
  });

  it('reports a ready, non-empty faux catalog when testFauxHarness is set', () => {
    const registry = new HarnessRegistry({
      primary: 'copilot',
      buildConfig: (type) => ({ type }),
      testFauxHarness: true,
    });

    const statuses = registry.getStatuses();
    const faux = statuses.find((s) => s.type === 'faux');
    expect(faux).toBeDefined();
    expect(faux?.ready).toBe(true);
    expect(faux?.installed).toBe(true);
    expect(faux?.connected).toBe(true);
    expect(faux?.authenticated).toBe(true);
    expect(faux?.models.length).toBeGreaterThan(0);
    expect(faux?.models).toEqual(FAUX_MODELS);

    expect(registry.readyTypes).toContain('faux');
  });

  it('getAllModels() includes the faux catalog, tagged with provider "faux"', async () => {
    const registry = new HarnessRegistry({
      primary: 'copilot',
      buildConfig: (type) => ({ type }),
      testFauxHarness: true,
    });

    const models = await registry.getAllModels();
    const fauxModels = models.filter((m) => m.provider === 'faux');
    expect(fauxModels.length).toBeGreaterThan(0);
  });

  it('does not add "faux" to ALL_HARNESS_TYPES — it stays out of /switch and login/logout', () => {
    expect(ALL_HARNESS_TYPES).not.toContain('faux');
  });

  it('a registry constructed with testFauxHarness still reports the real providers normally', () => {
    const registry = new HarnessRegistry({
      primary: 'copilot',
      buildConfig: (type) => ({ type }),
      testFauxHarness: true,
    });
    const statuses = registry.getStatuses();
    for (const type of ALL_HARNESS_TYPES) {
      expect(statuses.find((s) => s.type === type)).toBeDefined();
    }
    // Real providers are still unprobed/not-ready by default — the faux
    // flag does not change their verdicts.
    expect(statuses.find((s) => s.type === 'copilot')?.ready).toBe(false);
  });
});
