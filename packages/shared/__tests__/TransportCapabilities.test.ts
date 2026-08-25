// W29: TransportCapabilities conformance test.
//
// This test enforces two invariants:
//   1. Every field in TransportCapabilitySet is classified (each surface
//      declares ALL fields — no silent gaps).
//   2. No enforced field is missing from any production surface declaration.
//
// Adding a new capability field to TransportCapabilitySet without updating
// all surface declarations will fail this test.

import { describe, it, expect } from 'vitest';
import {
  WEB_CAPABILITIES,
  DESKTOP_CAPABILITIES,
  CLI_CAPABILITIES,
  SDK_CAPABILITIES,
  capabilitiesFor,
  type TransportCapabilitySet,
  type CapabilityEntry,
} from '../src/transport/TransportCapabilities.js';

const ALL_SURFACES: Record<string, TransportCapabilitySet> = {
  web: WEB_CAPABILITIES,
  desktop: DESKTOP_CAPABILITIES,
  cli: CLI_CAPABILITIES,
  sdk: SDK_CAPABILITIES,
};

// Canonical field list — derived from the WEB surface (assumed complete).
const CANONICAL_FIELDS = Object.keys(WEB_CAPABILITIES) as Array<keyof TransportCapabilitySet>;

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
    it('returns web capabilities for "web"', () => {
      expect(capabilitiesFor('web')).toBe(WEB_CAPABILITIES);
    });

    it('returns desktop capabilities for "desktop"', () => {
      expect(capabilitiesFor('desktop')).toBe(DESKTOP_CAPABILITIES);
    });

    it('returns CLI capabilities for "cli"', () => {
      expect(capabilitiesFor('cli')).toBe(CLI_CAPABILITIES);
    });

    it('falls back to SDK (most restrictive) for unknown surfaces', () => {
      expect(capabilitiesFor('unknown-surface')).toBe(SDK_CAPABILITIES);
      expect(capabilitiesFor('')).toBe(SDK_CAPABILITIES);
    });
  });

  describe('enforcement invariants', () => {
    it('web surface marks core streaming as enforced (reference implementation)', () => {
      expect(WEB_CAPABILITIES.sse).toEqual({ supported: true, enforcement: 'enforced' });
      expect(WEB_CAPABILITIES.eventReplay).toEqual({ supported: true, enforcement: 'enforced' });
    });

    it('CLI surface marks widget rendering as not supported (enforced)', () => {
      expect(CLI_CAPABILITIES.widgetRendering).toEqual({ supported: false, enforcement: 'enforced' });
    });

    it('SDK surface marks high-latency block delivery as enforced-supported', () => {
      expect(SDK_CAPABILITIES.highLatencyBlockDelivery).toEqual({ supported: true, enforcement: 'enforced' });
    });

    it('web surface marks cross-tab EventSource as aspirational (W09-b not yet shipped)', () => {
      expect(WEB_CAPABILITIES.crossTabEventSource.enforcement).toBe('aspirational');
    });
  });
});
