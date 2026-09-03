// W29: TransportCapabilities conformance test — the STATIC half.
//
// This file asserts the things that are true of the ledger as data:
//   1. Every surface declares every field (no silent gaps, no extras).
//   2. Every declared field carries an enforcement classification.
//   3. Every (surface, field) pair marked `enforced` names a proof, that proof
//      file exists, and it carries that pair's exact proof marker.
//   4. Nothing is registered as a proof for a pair that is not `enforced`,
//      and nothing is registered for a surface or field that does not exist.
//
// Rules 3 and 4 are the ones that make `enforced` mean something, and both
// were unsound before. The three specific unsoundnesses, each pinned by a test
// in "the proof mechanism itself" below:
//
//   - the check was `readFileSync(proof).includes(field)`, so a `describe`
//     title or a comment discharged a claim;
//   - `includes` is a SUBSTRING test, and `'asserts'.includes('sse')` is true,
//     so every test file in this repo was a valid proof of `sse`;
//   - the map was keyed per FIELD while `enforcement` is per (surface, field),
//     so one web-only probe discharged the same field's claim on cli, mobile
//     and sdk — surfaces it never loads.
//
// What is deliberately NOT claimed: none of this proves a registered probe
// asserts anything. See the header of `TransportCapabilities.ts`.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import {
  WEB_CAPABILITIES,
  DESKTOP_CAPABILITIES,
  CLI_CAPABILITIES,
  MOBILE_CAPABILITIES,
  SDK_CAPABILITIES,
  ENFORCEMENT_PROOFS,
  SURFACE_IDS,
  CAPABILITY_PROOF_MARKER,
  capabilityProofMarker,
  capabilityProofPattern,
  capabilityProofCoverage,
  capabilitiesFor,
  type SurfaceId,
  type TransportCapabilitySet,
  type CapabilityEntry,
} from '../src/transport/TransportCapabilities.js';

const ALL_SURFACES: Record<SurfaceId, TransportCapabilitySet> = {
  web: WEB_CAPABILITIES,
  desktop: DESKTOP_CAPABILITIES,
  cli: CLI_CAPABILITIES,
  mobile: MOBILE_CAPABILITIES,
  sdk: SDK_CAPABILITIES,
};

// Canonical field list — derived from the WEB surface (assumed complete).
const CANONICAL_FIELDS = Object.keys(WEB_CAPABILITIES) as Array<keyof TransportCapabilitySet>;

/** packages/shared/__tests__ → repo root. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('TransportCapabilities — W29 conformance', () => {
  for (const [surfaceName, caps] of Object.entries(ALL_SURFACES)) {
    describe(`surface: ${surfaceName}`, () => {
      it('declares every field in TransportCapabilitySet', () => {
        for (const field of CANONICAL_FIELDS) {
          const entry: CapabilityEntry | undefined = caps[field];
          expect(
            entry,
            `Surface '${surfaceName}' is missing field '${field}'. ` +
            `All surfaces must declare every capability; set it to e(false) or a(false) if unsupported.`,
          ).toBeDefined();
        }
      });

      it('classifies every declared field as enforced or aspirational (no unclassified fields)', () => {
        for (const field of CANONICAL_FIELDS) {
          const entry = caps[field];
          expect(
            entry?.enforcement,
            `Surface '${surfaceName}' field '${field}' has no enforcement classification. ` +
            `Use e(supported) for enforced or a(supported) for aspirational.`,
          ).toMatch(/^(enforced|aspirational)$/);
        }
      });

      it('has no extra fields beyond the canonical set', () => {
        const extraFields = Object.keys(caps).filter(
          (k) => !CANONICAL_FIELDS.includes(k as keyof TransportCapabilitySet),
        );
        expect(
          extraFields,
          `Surface '${surfaceName}' has extra undeclared fields: ${extraFields.join(', ')}. ` +
          `Add these to the TransportCapabilitySet interface first.`,
        ).toHaveLength(0);
      });
    });
  }

  describe('capabilitiesFor()', () => {
    it('returns each named surface\'s own set', () => {
      expect(capabilitiesFor('web')).toBe(WEB_CAPABILITIES);
      expect(capabilitiesFor('desktop')).toBe(DESKTOP_CAPABILITIES);
      expect(capabilitiesFor('cli')).toBe(CLI_CAPABILITIES);
      expect(capabilitiesFor('mobile')).toBe(MOBILE_CAPABILITIES);
      expect(capabilitiesFor('sdk')).toBe(SDK_CAPABILITIES);
    });

    it('falls back to SDK (most restrictive) for unknown surfaces', () => {
      expect(capabilitiesFor('unknown-surface')).toBe(SDK_CAPABILITIES);
      expect(capabilitiesFor('')).toBe(SDK_CAPABILITIES);
    });

    it('SURFACE_IDS lists exactly the surfaces the ledger declares', () => {
      // Otherwise a sixth surface could be added with no proof column at all
      // and every rule below would skip it.
      expect([...SURFACE_IDS].sort()).toEqual(Object.keys(ALL_SURFACES).sort());
    });
  });

  // ── The rule that makes `enforced` mean something ──────────────────────
  describe('every `enforced` claim names a proof that carries its marker', () => {
    const enforcedPairs: Array<[SurfaceId, keyof TransportCapabilitySet]> = [];
    for (const surface of SURFACE_IDS) {
      for (const field of CANONICAL_FIELDS) {
        if (ALL_SURFACES[surface][field]?.enforcement === 'enforced') {
          enforcedPairs.push([surface, field]);
        }
      }
    }

    it('has at least one enforced claim (guards against the list going empty)', () => {
      expect(enforcedPairs.length).toBeGreaterThan(0);
    });

    for (const [surface, field] of enforcedPairs) {
      describe(`${surface}/${field}`, () => {
        const proofs = ENFORCEMENT_PROOFS[surface][field] ?? [];

        it('names at least one proof file', () => {
          expect(
            proofs.length,
            `'${surface}.${field}' is marked 'enforced' but ENFORCEMENT_PROOFS registers no ` +
            `test for that SURFACE. A probe for a different surface is not a proof for this ` +
            `one. Write the probe and register it, or classify the field 'aspirational'.`,
          ).toBeGreaterThan(0);
        });

        for (const relPath of proofs) {
          it(`proof exists and carries the marker: ${relPath}`, () => {
            const abs = resolve(REPO_ROOT, relPath);
            expect(
              existsSync(abs),
              `ENFORCEMENT_PROOFS names '${relPath}' for '${surface}.${field}', but that file ` +
              `does not exist. Renaming or deleting a proof must not silently downgrade a claim.`,
            ).toBe(true);

            const marker = capabilityProofMarker(surface, field);
            expect(
              capabilityProofPattern(surface, field).test(readFileSync(abs, 'utf8')),
              `'${relPath}' is registered as the proof for '${surface}.${field}' but does not ` +
              `carry the token '${marker}'. Put that token inside the block that does the ` +
              `asserting — a bare mention of the field name is not a proof, which is exactly ` +
              `how this check used to pass on prose.`,
            ).toBe(true);
          });
        }
      });
    }

    it('registers no proof for a pair that is not enforced', () => {
      // The other direction: a registration that outlives its claim is a
      // stale claim of coverage, and it is what lets a downgraded field look
      // covered in the index while the ledger says otherwise.
      const orphans: string[] = [];
      for (const surface of SURFACE_IDS) {
        for (const field of Object.keys(ENFORCEMENT_PROOFS[surface])) {
          const typed = field as keyof TransportCapabilitySet;
          if (!CANONICAL_FIELDS.includes(typed)) {
            orphans.push(`${surface}/${field} (no such field)`);
          } else if (ALL_SURFACES[surface][typed]?.enforcement !== 'enforced') {
            orphans.push(`${surface}/${field} (declared aspirational)`);
          }
        }
      }
      expect(orphans, `ENFORCEMENT_PROOFS has stale registrations: ${orphans.join(', ')}`)
        .toHaveLength(0);
    });

    it('registers no proof column for a surface that does not exist', () => {
      const extra = Object.keys(ENFORCEMENT_PROOFS).filter(
        (s) => !SURFACE_IDS.includes(s as SurfaceId),
      );
      expect(extra, `ENFORCEMENT_PROOFS names unknown surfaces: ${extra.join(', ')}`).toHaveLength(0);
    });
  });

  // ── The mechanism's own soundness ─────────────────────────────────────
  describe('the proof mechanism itself', () => {
    it('is not satisfied by a substring — the bug that made every file a proof of `sse`', () => {
      // The historic false pass, verbatim. `'asserts'` contains `'sse'`, so
      // the old `readFileSync(proof).includes(field)` check was discharged by
      // any test file in the repo that used the word.
      expect('asserts'.includes('sse')).toBe(true);
      expect(capabilityProofPattern('sdk', 'sse').test('this file asserts things')).toBe(false);
    });

    it('is not satisfied by a describe title or a comment that names the field', () => {
      const prose = [
        "describe('W29 — fileAttachment / keyboardShortcuts', () => {",
        '// fileAttachment is handled elsewhere',
        'import { fileAttachment } from "./nope.js";',
      ].join('\n');
      expect(capabilityProofPattern('mobile', 'fileAttachment').test(prose)).toBe(false);
    });

    it('is not satisfied by another surface’s marker for the same field', () => {
      // The per-field/per-surface mismatch: a web probe used to discharge
      // mobile, cli and sdk claims for the same field.
      const webProof = capabilityProofMarker('web', 'terminalRendering');
      expect(capabilityProofPattern('web', 'terminalRendering').test(webProof)).toBe(true);
      expect(capabilityProofPattern('cli', 'terminalRendering').test(webProof)).toBe(false);
      expect(capabilityProofPattern('mobile', 'terminalRendering').test(webProof)).toBe(false);
    });

    it('is not satisfied by a longer field name that starts with this one', () => {
      const longer = `${CAPABILITY_PROOF_MARKER} web/markdownRenderingV2`;
      expect(capabilityProofPattern('web', 'markdownRendering').test(longer)).toBe(false);
    });

    it('is satisfied by the exact marker, however it is spaced', () => {
      expect(capabilityProofPattern('cli', 'sse').test('// @capability-proof cli/sse')).toBe(true);
      expect(capabilityProofPattern('cli', 'sse').test('*  @capability-proof   cli/sse — ok')).toBe(true);
    });
  });

  // ── Coverage is reported, not hidden ──────────────────────────────────
  describe('coverage', () => {
    it('classifies every unproven claim aspirational, so nothing looks checked that is not', () => {
      const { unproven } = capabilityProofCoverage(ALL_SURFACES);
      const lying = unproven.filter((pair) => {
        const [surface, field] = pair.split('/') as [SurfaceId, keyof TransportCapabilitySet];
        return ALL_SURFACES[surface][field]?.enforcement === 'enforced';
      });
      expect(
        lying,
        `These claims are marked 'enforced' with no probe registered for their surface: ` +
        `${lying.join(', ')}. 'enforced' is a promise that something checks it.`,
      ).toHaveLength(0);
    });

    it('still proves a meaningful share of the ledger (guards against downgrading everything)', () => {
      // The escape hatch from rule 3 is to reclassify a field `aspirational`,
      // which is honest once but would be a way to empty the ledger of
      // guarantees entirely if nothing watched the total.
      const { proven } = capabilityProofCoverage(ALL_SURFACES);
      expect(proven.length).toBeGreaterThanOrEqual(37);
    });
  });
});
