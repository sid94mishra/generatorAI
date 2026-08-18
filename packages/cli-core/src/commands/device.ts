// `generatorai device …` — this installation's credential, and the server's
// device registry.
//
// Nothing here ever prints a resume secret, an access token or a private key.
// `invite` prints pairing material by design — it is the thing the user has
// to carry to the new device — and says so.

import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { defineCommand, type CommandResult, type CommandSpec } from '../registry/CommandSpec.js';
import { CliError } from '../errors/CliError.js';
import { ConnectionManager } from '../connection/ConnectionManager.js';
import {
  defaultCliDeviceName,
  describeCliSecretBackend,
  getCliAuthRuntime,
  parseCliPairingCode,
} from '../auth/cliAuth.js';
import { idColumn, inputSchema, list, ok, record } from './_shared.js';

/**
 * Reads the server's per-launch local admin token.
 *
 * A deliberate cross-process file contract rather than a shared import: the
 * CLI must not depend on the server package, and `@generatorai/shared` is
 * isomorphic so it cannot pull in `node:fs`.
 */
function readLocalAdminToken(dataDir: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dataDir, 'local-admin.json'), 'utf8'));
    const token = (parsed as { token?: unknown } | null)?.token;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/** Where the server keeps its data, resolved in the same order the server does. */
function candidateDataDirs(): string[] {
  const candidates: string[] = [];
  if (process.env['DB_PATH']) candidates.push(dirname(resolve(process.env['DB_PATH'])));
  if (process.env['GENERATORAI_SECRETS_DIR']) candidates.push(process.env['GENERATORAI_SECRETS_DIR']);

  // Walk up from the working directory: the user runs this from wherever they
  // happen to be inside the repo, not necessarily its root.
  let dir = process.cwd();
  for (;;) {
    candidates.push(join(dir, 'packages', 'db', 'data'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  candidates.push(join(homedir(), '.generatorai'));
  return candidates;
}

function findLocalAdminToken(explicitDir?: string): { token: string; dir: string } | null {
  const dirs = explicitDir ? [explicitDir] : candidateDataDirs();
  for (const dir of dirs) {
    if (!existsSync(join(dir, 'local-admin.json'))) continue;
    const token = readLocalAdminToken(dir);
    if (token) return { token, dir };
  }
  return null;
}

/**
 * Mints an invite with the local admin bearer token.
 *
 * Deliberately not routed through the API client: that client always presents
 * this installation's device credential, which is precisely what does not
 * exist yet during bootstrap.
 */
async function inviteWithAdminToken(
  baseUrl: string,
  token: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/auth/devices/invites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new CliError(
      'UNAVAILABLE',
      detail?.error?.message ?? `Could not mint an invite (HTTP ${response.status}).`,
      { hint: 'Is the server running, and is local-admin.json from this launch of it?' },
    );
  }
  return (await response.json()) as Record<string, unknown>;
}

export const DEVICE_GROUP = {
  name: 'device',
  summary: 'Pairing, this installation\'s credential, and the device registry',
  order: 2,
};

export function deviceCommands(): CommandSpec[] {
  return [
    defineCommand({
      id: 'device.pair',
      group: 'device',
      verb: 'pair',
      summary: 'Pair this CLI with a server using a pairing code',
      // The one command that must work with no credential — that is what it
      // is for.
      requiresServer: false,
      sinceVersion: '0.2.0',
      examples: ['generatorai device pair XXXX-XXXX-XXXX', 'generatorai device pair "generatorai://pair?code=…"'],
      args: [{ name: 'code', description: 'Pairing code or generatorai://pair URL', required: true }],
      flags: [
        { name: 'name', description: 'Name to register this device under', type: 'string' },
        { name: 'yesTrust', description: 'Skip the host-identity confirmation', type: 'boolean', hidden: true },
      ],
      schema: inputSchema(
        { code: z.string().min(1) },
        { name: z.string().optional(), yesTrust: z.boolean().optional() },
      ),
      output: { kind: 'record', successMessage: 'Paired.' },
      async handler(ctx, { args, flags }) {
        const consent = parseCliPairingCode(args.code);

        // The consent screen is not decoration. The code is entirely
        // attacker-controllable, so the user must see which host and which
        // scopes they are about to grant before anything is redeemed.
        if (!flags.yesTrust && !ctx.assumeYes) {
          ctx.emit({ type: 'log', level: 'info', message: `Server:      ${consent.serverName}` });
          ctx.emit({ type: 'log', level: 'info', message: `Endpoint:    ${consent.endpoint}` });
          ctx.emit({ type: 'log', level: 'info', message: `Fingerprint: ${consent.fingerprint}` });
          ctx.emit({
            type: 'log',
            level: 'info',
            message: `Scopes:      ${consent.requestedScopes.join(', ') || 'none requested'}`,
          });

          const approved = await ctx.prompt.confirm(
            'Does this match the server you meant to pair with?',
            false,
          );
          if (!approved) {
            throw new CliError('CANCELLED', 'Pairing cancelled.');
          }
        }

        const runtime = getCliAuthRuntime({
          endpoint: consent.endpoint,
          serverId: consent.serverId,
          profile: ctx.config.activeProfile,
        });

        const session = await runtime.completePairing({
          endpoint: consent.endpoint,
          endpoints: consent.endpoints.map((e) => e.origin),
          serverId: consent.serverId,
          pairingToken: consent.pairingGrant,
          deviceName: flags.name ?? defaultCliDeviceName(),
          platform: 'cli',
        });

        // Record the connection so subsequent commands find it without the
        // user having to run `connect add` as a second step.
        const manager = new ConnectionManager();
        manager.upsert({
          serverId: consent.serverId,
          label: consent.serverName,
          endpoint: consent.endpoint,
          endpoints: consent.endpoints.map((e) => e.origin),
          kind: 'remote',
          managed: false,
          lastConnectedAt: Date.now(),
        });

        return record(
          {
            serverName: consent.serverName,
            serverId: consent.serverId,
            fingerprint: consent.fingerprint,
            deviceId: (session as unknown as { deviceId?: string }).deviceId ?? null,
            scopes: consent.requestedScopes,
          },
          `Paired with "${consent.serverName}".`,
        );
      },
    }),

    defineCommand({
      id: 'device.status',
      group: 'device',
      verb: 'status',
      summary: 'This installation\'s credential and where it is stored',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: { kind: 'record' },
      async handler(ctx): Promise<CommandResult<unknown>> {
        const backend = await describeCliSecretBackend();
        const manager = new ConnectionManager();
        const active = manager.active();

        if (!active) {
          return {
            data: { paired: false, vault: backend },
            warnings: ['No server is configured.'],
          };
        }

        const runtime = getCliAuthRuntime({
          endpoint: active.endpoint,
          serverId: active.serverId,
          profile: ctx.config.activeProfile,
          legacyApiKey: ctx.config.server.apiKey,
        });
        const state = await runtime.initialize();

        const warnings: string[] = [];
        if (!backend.secure) {
          warnings.push(
            `Credentials are in the ${backend.kind} backend (0600 file), not an OS keychain.`,
          );
        }
        if (ctx.config.server.apiKey) {
          warnings.push('A legacy API key is configured and bypasses DPoP. Pair instead.');
        }

        return {
          data: {
            server: active.label,
            serverId: active.serverId,
            endpoint: active.endpoint,
            state: state.status,
            ...(state.status === 'authenticated'
              ? {
                  deviceId: state.deviceId,
                  scopes: state.scopes,
                  expiresAt: new Date(state.expiresAt).toISOString(),
                }
              : {}),
            vault: backend,
          },
          warnings,
        };
      },
    }),

    defineCommand({
      id: 'device.forget',
      group: 'device',
      verb: 'forget',
      summary: 'Delete this installation\'s credential for a server',
      requiresServer: false,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'connection', description: 'Connection; omit for the active one', required: false, completes: 'connection' }],
      flags: [],
      schema: inputSchema({ connection: z.string().optional() }, {}),
      output: { kind: 'void', successMessage: 'Credential removed.' },
      async handler(ctx, { args }) {
        const manager = new ConnectionManager();
        const target = args.connection ? manager.require(args.connection) : manager.active();
        if (!target) throw new CliError('USAGE', 'No connection is configured.');

        const runtime = getCliAuthRuntime({
          endpoint: target.endpoint,
          serverId: target.serverId,
          profile: ctx.config.activeProfile,
        });
        await runtime.forget();

        return {
          data: null,
          message: `Forgot the credential for "${target.label}".`,
          warnings: [
            'The server still lists this device until it is revoked there.',
            `Run \`generatorai device list\` from an admin device to remove it.`,
          ],
        };
      },
    }),

    defineCommand({
      id: 'device.list',
      group: 'device',
      verb: 'list',
      aliases: ['ls'],
      summary: 'Devices paired with the server',
      requiresServer: true,
      scopes: ['admin:devices'],
      sinceVersion: '0.2.0',
      args: [],
      flags: [{ name: 'all', description: 'Include revoked devices', type: 'boolean' }],
      schema: inputSchema({}, { all: z.boolean().optional() }),
      output: {
        kind: 'list',
        columns: [
          { key: 'deviceId', header: 'Device ID', format: 'id', priority: 0 },
          { key: 'name', header: 'Name', priority: 0 },
          { key: 'platform', header: 'Platform', priority: 1 },
          { key: 'scopes', header: 'Scopes', format: 'list', priority: 2 },
          { key: 'lastSeenAt', header: 'Last seen', format: 'relative', priority: 1 },
          { key: 'revokedAt', header: 'Revoked', format: 'relative', priority: 3 },
        ],
      },
      async handler(ctx, { flags }) {
        const devices = await ctx.api.devices.list();
        return list(flags.all ? devices : devices.filter((d) => !d.revokedAt));
      },
    }),

    defineCommand({
      id: 'device.revoke',
      group: 'device',
      verb: 'revoke',
      summary: 'Revoke another device\'s credential',
      requiresServer: true,
      scopes: ['admin:devices'],
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'device', description: 'Device id', required: true }],
      flags: [],
      schema: inputSchema({ device: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Revoked.' },
      async handler(ctx, { args }) {
        const devices = await ctx.api.devices.list();
        const target = devices.find(
          (d) => d.deviceId === args.device || d.deviceId.startsWith(args.device),
        );
        if (!target) throw CliError.notFound('device', args.device);

        await ctx.api.devices.revoke(target.deviceId);
        return ok(`Revoked "${target.name}". It loses access on its next request.`);
      },
    }),

    defineCommand({
      id: 'device.scopes',
      group: 'device',
      verb: 'scopes',
      summary: 'Show or set a device\'s scopes',
      requiresServer: true,
      scopes: ['admin:devices'],
      sinceVersion: '0.2.0',
      args: [
        { name: 'device', description: 'Device id', required: true },
        { name: 'scopes', description: 'Comma-separated scopes; omit to read', required: false },
      ],
      flags: [],
      schema: inputSchema({ device: z.string(), scopes: z.string().optional() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const devices = await ctx.api.devices.list();
        const target = devices.find(
          (d) => d.deviceId === args.device || d.deviceId.startsWith(args.device),
        );
        if (!target) throw CliError.notFound('device', args.device);

        if (!args.scopes) return record({ deviceId: target.deviceId, scopes: target.scopes });

        const scopes = args.scopes.split(',').map((s) => s.trim()).filter(Boolean);
        return record(
          await ctx.api.devices.setScopes(target.deviceId, scopes),
          `Scopes for "${target.name}" set to ${scopes.join(', ')}.`,
        );
      },
    }),

    defineCommand({
      id: 'device.invite',
      group: 'device',
      verb: 'invite',
      summary: 'Mint a pairing code for a new device',
      requiresServer: true,
      scopes: ['admin:devices'],
      sinceVersion: '0.2.0',
      args: [],
      flags: [
        { name: 'scopes', description: 'Comma-separated scopes to request', type: 'string' },
        { name: 'ttl', description: 'Validity in minutes', type: 'number', default: 10 },
        {
          name: 'dataDir',
          description: "Server data directory holding local-admin.json (bootstrap only)",
          type: 'string',
        },
      ],
      schema: inputSchema(
        {},
        {
          scopes: z.string().optional(),
          ttl: z.coerce.number().int().positive().default(10),
          dataDir: z.string().optional(),
        },
      ),
      output: { kind: 'record' },
      async handler(ctx, { flags }) {
        const body = {
          ...(flags.scopes ? { scopes: flags.scopes.split(',').map((s) => s.trim()) } : {}),
          ttlMs: (flags.ttl ?? 10) * 60_000,
        };

        // Bootstrap: the very first device on a machine has no credential to
        // authenticate this call with, so fall back to the server's
        // per-launch local admin token. Without this there is no way to pair
        // anything on a fresh install.
        const admin = findLocalAdminToken(flags.dataDir);
        const result = admin
          ? await inviteWithAdminToken(ctx.baseUrl, admin.token, body)
          : await ctx.api.devices.createInvite(body);

        return {
          data: result,
          warnings: [
            'This code grants pairing access. Treat it like a password and let it expire unused if you do not use it.',
            ...(admin ? [`Authorised with the server's local admin token from ${admin.dir}.`] : []),
          ],
        };
      },
    }),

    defineCommand({
      id: 'device.invites',
      group: 'device',
      verb: 'invites',
      summary: 'Pairing codes that have not been redeemed yet',
      requiresServer: true,
      scopes: ['admin:devices'],
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          { key: 'scopes', header: 'Scopes', format: 'list', priority: 1 },
          { key: 'expiresAt', header: 'Expires', format: 'relative', priority: 0 },
        ],
      },
      async handler(ctx) {
        return list(await ctx.api.devices.pendingInvites());
      },
    }),

    defineCommand({
      id: 'device.audit',
      group: 'device',
      verb: 'audit',
      summary: 'Authentication events',
      requiresServer: true,
      scopes: ['admin:devices'],
      sinceVersion: '0.2.0',
      args: [],
      flags: [{ name: 'limit', description: 'Maximum rows', type: 'number', default: 50 }],
      schema: inputSchema({}, { limit: z.coerce.number().int().positive().default(50) }),
      output: {
        kind: 'list',
        columns: [
          { key: 'timestamp', header: 'When', format: 'relative', priority: 0 },
          { key: 'event', header: 'Event', priority: 0 },
          { key: 'deviceId', header: 'Device', format: 'id', priority: 1 },
          { key: 'outcome', header: 'Outcome', format: 'status', priority: 0 },
        ],
      },
      async handler(ctx, { flags }) {
        return list(await ctx.api.devices.audit({ limit: flags.limit }));
      },
    }),
  ];
}
