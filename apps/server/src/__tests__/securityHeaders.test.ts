// ────────────────────────────────────────────────────────────────
// Security headers — APPLICATION-REVIEW-2026-09 plan item 14.
//
// The app used to rely on the shipped nginx config for nosniff and
// Referrer-Policy and set no HSTS or Permissions-Policy anywhere. These
// tests pin the headers to the Express app itself so a deployment without
// that exact nginx front is not silently unprotected.
// ────────────────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  HSTS_VALUE,
  PERMISSIONS_POLICY,
  REFERRER_POLICY,
  createSecurityHeadersMiddleware,
  isHttpsRequest,
  shouldSendHsts,
} from '../middleware/securityHeaders.js';
import { parseTrustProxy } from '../network/requestOrigin.js';

function makeApp() {
  const app = express();
  app.use(createSecurityHeadersMiddleware());
  app.get('/x', (_req, res) => res.send('ok'));
  return app;
}

describe('security headers middleware', () => {
  it('sets nosniff, Referrer-Policy and Permissions-Policy on every response', async () => {
    const res = await request(makeApp()).get('/x');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe(REFERRER_POLICY);
    expect(res.headers['permissions-policy']).toBe(PERMISSIONS_POLICY);
  });

  it('denies camera and geolocation but leaves the microphone to same-origin (voice input)', () => {
    expect(PERMISSIONS_POLICY).toContain('camera=()');
    expect(PERMISSIONS_POLICY).toContain('geolocation=()');
    expect(PERMISSIONS_POLICY).toContain('microphone=(self)');
  });

  it('does NOT emit Strict-Transport-Security on a plain HTTP request', async () => {
    const res = await request(makeApp()).get('/x');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('ignores X-Forwarded-Proto from a client when no proxy is trusted (D-114)', async () => {
    const res = await request(makeApp()).get('/x').set('X-Forwarded-Proto', 'https');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('emits Strict-Transport-Security when a trusted loopback proxy forwards https for a hostname', async () => {
    const app = express();
    app.use(createSecurityHeadersMiddleware(parseTrustProxy('loopback')));
    app.get('/x', (_req, res) => res.send('ok'));
    const res = await request(app).get('/x').set('X-Forwarded-Proto', 'https').set('X-Forwarded-Host', 'box.tailnet.ts.net');
    expect(res.headers['strict-transport-security']).toBe(HSTS_VALUE);
  });

  it('keys on the client-facing hop of a trusted proxy chain, case-insensitively', () => {
    const trusted = parseTrustProxy('loopback');
    const mk = (proto: string | string[] | undefined, encrypted = false) => ({
      socket: { remoteAddress: '127.0.0.1', encrypted },
      headers: proto === undefined ? {} : { 'x-forwarded-proto': proto },
    });
    expect(isHttpsRequest(mk('https, http'), trusted)).toBe(true);
    expect(isHttpsRequest(mk('HTTPS'), trusted)).toBe(true);
    expect(isHttpsRequest(mk('http, https'), trusted)).toBe(false);
    expect(isHttpsRequest(mk(['https']), trusted)).toBe(true);
    expect(isHttpsRequest(mk(undefined), trusted)).toBe(false);
    expect(isHttpsRequest(mk(undefined, true), trusted)).toBe(true);
    // An untrusted peer's header is ignored.
    expect(isHttpsRequest({ socket: { remoteAddress: '192.168.1.9' }, headers: { 'x-forwarded-proto': 'https' } }, trusted)).toBe(false);
  });

  it('never pins HSTS to an IP address or localhost, even over TLS', () => {
    const tlsReq = (host: string) => ({ socket: { remoteAddress: '192.168.1.9', encrypted: true }, headers: { host } });
    expect(shouldSendHsts(tlsReq('192.168.1.20:3100'))).toBe(false);
    expect(shouldSendHsts(tlsReq('[fd00::1]:3100'))).toBe(false);
    expect(shouldSendHsts(tlsReq('localhost:3100'))).toBe(false);
    expect(shouldSendHsts(tlsReq('box.local:3100'))).toBe(true);
  });
});
