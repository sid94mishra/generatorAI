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
} from '../middleware/securityHeaders.js';

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

  it('emits Strict-Transport-Security when a TLS-terminating proxy forwards https', async () => {
    const res = await request(makeApp()).get('/x').set('X-Forwarded-Proto', 'https');
    expect(res.headers['strict-transport-security']).toBe(HSTS_VALUE);
  });

  it('keys HSTS on the client-facing hop of a proxy chain, case-insensitively', () => {
    const mk = (proto: string | string[] | undefined) => ({
      secure: false,
      headers: proto === undefined ? {} : { 'x-forwarded-proto': proto },
    });
    expect(isHttpsRequest(mk('https, http'))).toBe(true);
    expect(isHttpsRequest(mk('HTTPS'))).toBe(true);
    expect(isHttpsRequest(mk('http, https'))).toBe(false);
    expect(isHttpsRequest(mk(['https']))).toBe(true);
    expect(isHttpsRequest(mk(undefined))).toBe(false);
    expect(isHttpsRequest({ secure: true, headers: {} })).toBe(true);
  });
});
