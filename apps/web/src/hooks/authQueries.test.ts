// ────────────────────────────────────────────────────────────────
// P5-11: the one branchy piece of real risk in splitting AuthGate's logic
// from its view — which of the three outcomes (loading / app / pairing) the
// gate renders. Pins the pre-split behaviour exactly.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { resolveGateOutcome } from './authQueries.js';

const base = {
  ready: true,
  autoPairing: false,
  authenticated: false,
  openServer: false,
  hasApiKey: false,
};

describe('resolveGateOutcome', () => {
  it('is loading before auth has initialised', () => {
    expect(resolveGateOutcome({ ...base, ready: false })).toBe('loading');
  });

  it('is loading while desktop is silently auto-pairing, even once ready', () => {
    expect(resolveGateOutcome({ ...base, ready: true, autoPairing: true })).toBe('loading');
  });

  it('renders the app once authenticated', () => {
    expect(resolveGateOutcome({ ...base, authenticated: true })).toBe('app');
  });

  it('renders the app for an open (unauthenticated-loopback) server', () => {
    expect(resolveGateOutcome({ ...base, openServer: true })).toBe('app');
  });

  it('renders the app for a legacy shared API key, even when unpaired', () => {
    expect(resolveGateOutcome({ ...base, hasApiKey: true })).toBe('app');
  });

  it('falls back to the pairing screen when none of those hold', () => {
    expect(resolveGateOutcome(base)).toBe('pairing');
  });

  it('auto-pairing outranks an otherwise-authenticated state (still mid-handshake)', () => {
    expect(resolveGateOutcome({ ...base, authenticated: true, autoPairing: true })).toBe('loading');
  });
});
