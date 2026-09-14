// ────────────────────────────────────────────────────────────────
// GitHubDeviceFlow — OAuth device-authorization grant for GitHub
// ────────────────────────────────────────────────────────────────
//
// Two calls: `start()` asks the host for a device + user code, the client
// shows the code and the verification URL, then the server polls `poll()`
// until the user approves. Works against github.com and Enterprise Server
// (the device endpoints live on the *web* host, not the `/api/v3` base).
//
// The access token returned by `poll()` is handed straight to the caller for
// the secret store — it is never logged.

import type { IScmHttpClient } from './ports.js';
import { SourceControlError } from './errors.js';

export interface GitHubDeviceFlowOptions {
  /** OAuth app client id (device flow needs no client secret). */
  clientId: string;
  /** Enterprise host base URL (omit for github.com). */
  host?: string;
  /** Requested scopes. Default `repo workflow`. */
  scope?: string;
}

export interface DeviceCodeGrant {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type DevicePollResult =
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'complete'; token: string; scopes?: string[] }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'error'; error: string };

const DEFAULT_SCOPE = 'repo workflow';
const DEFAULT_INTERVAL = 5;

/**
 * Web base for the device endpoints: `https://github.com` for the public
 * host, otherwise the Enterprise host itself with any `/api/v3` suffix and
 * trailing slashes stripped. Exported for tests.
 */
export function deviceFlowWebBase(host?: string): string {
  if (!host) return 'https://github.com';
  const trimmed = host.trim().replace(/\/+$/, '');
  if (!trimmed) return 'https://github.com';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const clean = withScheme.replace(/\/api\/v3\/?$/i, '').replace(/\/+$/, '');
  if (/^https?:\/\/(www\.)?github\.com$/i.test(clean)) return 'https://github.com';
  return clean;
}

export class GitHubDeviceFlow {
  constructor(
    private readonly http: IScmHttpClient,
    private readonly options: GitHubDeviceFlowOptions,
  ) {}

  private get webBase(): string {
    return deviceFlowWebBase(this.options.host);
  }

  /** Request a device + user code. */
  async start(): Promise<DeviceCodeGrant> {
    const res = await this.http.request({
      method: 'POST',
      url: `${this.webBase}/login/device/code`,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'GeneratorAI',
      },
      body: JSON.stringify({
        client_id: this.options.clientId,
        scope: this.options.scope ?? DEFAULT_SCOPE,
      }),
      timeout: 15_000,
    });
    if (res.status >= 400) {
      throw new SourceControlError(`GitHub device code request failed (${res.status})`);
    }
    const data = JSON.parse(res.body) as {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      expires_in?: number;
      interval?: number;
      error?: string;
    };
    if (data.error || !data.device_code) {
      throw new SourceControlError(
        `GitHub device code request failed: ${data.error ?? 'no device_code in response'}`,
      );
    }
    return {
      deviceCode: data.device_code,
      userCode: data.user_code ?? '',
      verificationUri: data.verification_uri ?? `${this.webBase}/login/device`,
      expiresIn: data.expires_in ?? 900,
      interval: data.interval ?? DEFAULT_INTERVAL,
    };
  }

  /** Poll once for the access token. Callers wait `interval` seconds between polls. */
  async poll(deviceCode: string): Promise<DevicePollResult> {
    const res = await this.http.request({
      method: 'POST',
      url: `${this.webBase}/login/oauth/access_token`,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'GeneratorAI',
      },
      body: JSON.stringify({
        client_id: this.options.clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
      timeout: 15_000,
    });
    let data: {
      error?: string;
      access_token?: string;
      scope?: string;
      interval?: number;
    };
    try {
      data = JSON.parse(res.body) as typeof data;
    } catch {
      return { status: 'error', error: `Unparseable device-flow response (${res.status})` };
    }

    if (data.error) {
      switch (data.error) {
        case 'authorization_pending':
          return { status: 'pending' };
        case 'slow_down':
          return { status: 'slow_down', interval: (data.interval ?? DEFAULT_INTERVAL) + 5 };
        case 'expired_token':
          return { status: 'expired' };
        case 'access_denied':
          return { status: 'denied' };
        default:
          return { status: 'error', error: data.error };
      }
    }
    if (!data.access_token) {
      return { status: 'error', error: `Device flow returned no token (${res.status})` };
    }
    const scopes = (data.scope ?? '').split(/[ ,]+/).filter(Boolean);
    return { status: 'complete', token: data.access_token, scopes };
  }
}
