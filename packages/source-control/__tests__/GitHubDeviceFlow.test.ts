import { describe, it, expect } from 'vitest';
import { GitHubDeviceFlow, deviceFlowWebBase } from '../src/GitHubDeviceFlow.js';
import { SourceControlError } from '../src/errors.js';
import type { IScmHttpClient, ScmHttpRequestOptions, ScmHttpResponse } from '../src/ports.js';

function mockHttp(
  handler: (opts: ScmHttpRequestOptions) => ScmHttpResponse,
  calls?: ScmHttpRequestOptions[],
): IScmHttpClient {
  return {
    request: async (opts) => {
      calls?.push(opts);
      return handler(opts);
    },
  };
}

const json = (body: unknown, status = 200): ScmHttpResponse => ({
  status,
  headers: {},
  body: JSON.stringify(body),
});

describe('deviceFlowWebBase', () => {
  it('uses github.com for the public host', () => {
    expect(deviceFlowWebBase()).toBe('https://github.com');
    expect(deviceFlowWebBase('github.com')).toBe('https://github.com');
    expect(deviceFlowWebBase('https://github.com/')).toBe('https://github.com');
    expect(deviceFlowWebBase('https://api.github.com')).toBe('https://api.github.com');
  });

  it('strips /api/v3 and trailing slashes from enterprise hosts', () => {
    expect(deviceFlowWebBase('https://ghe.acme.com/api/v3')).toBe('https://ghe.acme.com');
    expect(deviceFlowWebBase('https://ghe.acme.com/api/v3/')).toBe('https://ghe.acme.com');
    expect(deviceFlowWebBase('https://ghe.acme.com//')).toBe('https://ghe.acme.com');
    expect(deviceFlowWebBase('ghe.acme.com')).toBe('https://ghe.acme.com');
  });
});

describe('GitHubDeviceFlow.start', () => {
  it('POSTs the device-code request and parses the grant', async () => {
    const calls: ScmHttpRequestOptions[] = [];
    const http = mockHttp(
      () =>
        json({
          device_code: 'dev-1',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          expires_in: 899,
          interval: 7,
        }),
      calls,
    );
    const flow = new GitHubDeviceFlow(http, { clientId: 'cid' });
    const grant = await flow.start();
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://github.com/login/device/code');
    expect(calls[0]?.headers?.['Accept']).toBe('application/json');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      client_id: 'cid',
      scope: 'repo workflow',
    });
    expect(grant).toEqual({
      deviceCode: 'dev-1',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 899,
      interval: 7,
    });
  });

  it('defaults the interval to 5 and honours a custom scope', async () => {
    const calls: ScmHttpRequestOptions[] = [];
    const flow = new GitHubDeviceFlow(
      mockHttp(() => json({ device_code: 'd', user_code: 'U', verification_uri: 'v' }), calls),
      { clientId: 'cid', scope: 'repo' },
    );
    const grant = await flow.start();
    expect(grant.interval).toBe(5);
    expect(JSON.parse(calls[0]?.body ?? '{}').scope).toBe('repo');
  });

  it('uses the enterprise web base (not /api/v3)', async () => {
    const calls: ScmHttpRequestOptions[] = [];
    const flow = new GitHubDeviceFlow(
      mockHttp(() => json({ device_code: 'd', user_code: 'U', verification_uri: 'v' }), calls),
      { clientId: 'cid', host: 'https://ghe.acme.com/api/v3' },
    );
    await flow.start();
    expect(calls[0]?.url).toBe('https://ghe.acme.com/login/device/code');
  });

  it('throws when the host rejects the request', async () => {
    const flow = new GitHubDeviceFlow(
      mockHttp(() => ({ status: 422, headers: {}, body: '{}' })),
      { clientId: 'cid' },
    );
    await expect(flow.start()).rejects.toBeInstanceOf(SourceControlError);
  });
});

describe('GitHubDeviceFlow.poll', () => {
  function flowFor(body: unknown, calls?: ScmHttpRequestOptions[]): GitHubDeviceFlow {
    return new GitHubDeviceFlow(mockHttp(() => json(body), calls), { clientId: 'cid' });
  }

  it('POSTs the token request with the device grant type', async () => {
    const calls: ScmHttpRequestOptions[] = [];
    await flowFor({ error: 'authorization_pending' }, calls).poll('dev-1');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://github.com/login/oauth/access_token');
    expect(calls[0]?.headers?.['Accept']).toBe('application/json');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      client_id: 'cid',
      device_code: 'dev-1',
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
  });

  it('maps authorization_pending → pending', async () => {
    expect(await flowFor({ error: 'authorization_pending' }).poll('d')).toEqual({
      status: 'pending',
    });
  });

  it('maps slow_down → interval + 5', async () => {
    expect(await flowFor({ error: 'slow_down', interval: 10 }).poll('d')).toEqual({
      status: 'slow_down',
      interval: 15,
    });
    expect(await flowFor({ error: 'slow_down' }).poll('d')).toEqual({
      status: 'slow_down',
      interval: 10,
    });
  });

  it('maps expired_token → expired and access_denied → denied', async () => {
    expect(await flowFor({ error: 'expired_token' }).poll('d')).toEqual({ status: 'expired' });
    expect(await flowFor({ error: 'access_denied' }).poll('d')).toEqual({ status: 'denied' });
  });

  it('maps an unknown error through', async () => {
    expect(await flowFor({ error: 'incorrect_client_credentials' }).poll('d')).toEqual({
      status: 'error',
      error: 'incorrect_client_credentials',
    });
  });

  it('maps success → complete with parsed scopes', async () => {
    expect(await flowFor({ access_token: 'gho_x', scope: 'repo,workflow' }).poll('d')).toEqual({
      status: 'complete',
      token: 'gho_x',
      scopes: ['repo', 'workflow'],
    });
    expect(await flowFor({ access_token: 'gho_x', scope: 'repo workflow' }).poll('d')).toEqual({
      status: 'complete',
      token: 'gho_x',
      scopes: ['repo', 'workflow'],
    });
    expect(await flowFor({ access_token: 'gho_x' }).poll('d')).toEqual({
      status: 'complete',
      token: 'gho_x',
      scopes: [],
    });
  });

  it('reports an error when the body has neither token nor error', async () => {
    const result = await flowFor({}).poll('d');
    expect(result.status).toBe('error');
  });

  it('polls the enterprise web base', async () => {
    const calls: ScmHttpRequestOptions[] = [];
    const flow = new GitHubDeviceFlow(
      mockHttp(() => json({ error: 'authorization_pending' }), calls),
      { clientId: 'cid', host: 'https://ghe.acme.com' },
    );
    await flow.poll('d');
    expect(calls[0]?.url).toBe('https://ghe.acme.com/login/oauth/access_token');
  });
});
