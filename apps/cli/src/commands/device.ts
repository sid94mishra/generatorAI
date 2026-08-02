// ────────────────────────────────────────────────────────────────
// `generatorai device` — pair this CLI, and manage every paired client.
//
// Two groups of subcommands:
//
//   Local identity      pair / status / forget
//     Act on THIS installation's credential. `pair` is the only one that
//     works before the CLI has any credential at all.
//
//   Remote management   list / revoke / invite / audit
//     Act on the server's device registry and need `admin:devices`.
//
// Nothing here ever prints a resume secret, an access token or a private key.
// `invite` prints pairing material by design — it is the thing the user has
// to carry to the new device — and says so.
// ────────────────────────────────────────────────────────────────

import type { Command } from 'commander';
import chalk from 'chalk';
import {
  defaultCliDeviceName,
  describeCliSecretBackend,
  getCliAuthRuntime,
  parseCliPairingCode,
} from '../platform/authRuntime.js';
import { loadCLIConfig } from '../config/loadConfig.js';
import { outputJson, outputList, outputRecord } from '../output/format.js';

interface DeviceSummary {
  deviceId: string;
  name: string;
  platform: string;
  scopes: string[];
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
  credentialVersion: number;
  jwkThumbprint: string;
}

async function serverUrl(globalOpts: { server?: string }): Promise<string> {
  if (globalOpts.server) return globalOpts.server.replace(/\/$/, '');
  const config = await loadCLIConfig();
  return config.server.url.replace(/\/$/, '');
}

function fmtTime(ts: number | null): string {
  return ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 19) : '—';
}

/**
 * Authenticated call against the server's auth API.
 *
 * Deliberately not routed through `CLIPlatformClient`: device management is
 * meaningless in the in-process `direct` mode, and these endpoints must always
 * use this installation's own device credential.
 */
async function adminRequest<T = unknown>(
  program: Command,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const endpoint = await serverUrl(program.opts());
  const runtime = getCliAuthRuntime({
    endpoint,
    legacyApiKey: process.env['GENERATORAI_API_KEY'],
    profile: process.env['GENERATORAI_PROFILE'],
  });
  const response = await runtime.fetch(`${endpoint}${path}`, init ?? {});
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    const message = body?.error?.message ?? response.statusText;
    if (response.status === 401) {
      throw new Error(
        `${message}\nThis CLI is not paired with ${endpoint}. Run \`generatorai device pair <code>\`.`,
      );
    }
    if (response.status === 403) {
      throw new Error(`${message}\nThis device lacks the admin:devices scope.`);
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function registerDeviceCommands(program: Command): void {
  const device = program
    .command('device')
    .description('Pair this CLI with a server and manage paired devices');

  // ── pair ─────────────────────────────────────────────────────────
  device
    .command('pair')
    .description('Pair this CLI with a GeneratorAI server using a pairing code')
    .argument('<code>', 'Pairing code or generatorai://pair?code=… link')
    .option('--name <name>', 'Name shown in the device list')
    .option('--json', 'Output JSON')
    .action(async (code: string, opts: { name?: string; json?: boolean }) => {
      let consent;
      try {
        consent = parseCliPairingCode(code);
      } catch (err) {
        process.stderr.write(
          chalk.red(`Invalid pairing code: ${err instanceof Error ? err.message : String(err)}\n`),
        );
        process.exitCode = 1;
        return;
      }

      // Informed consent: show the host and the exact authority being granted
      // BEFORE any key material is created or sent.
      if (!opts.json) {
        process.stderr.write(chalk.bold('\n  Pairing with\n'));
        process.stderr.write(`    server    ${consent.serverName ?? 'GeneratorAI'}\n`);
        process.stderr.write(`    endpoint  ${consent.endpoint}\n`);
        process.stderr.write(`    identity  ${consent.serverId}\n`);
        process.stderr.write(
          `    scopes    ${consent.offer.requestedScopes.join(', ')}\n\n`,
        );
      }

      const runtime = getCliAuthRuntime({ endpoint: consent.endpoint });
      try {
        const session = await runtime.completePairing({
          endpoint: consent.endpoint,
          serverId: consent.serverId,
          pairingToken: consent.offer.pairingGrant,
          deviceName: opts.name ?? defaultCliDeviceName(),
          platform: 'cli',
          connectionMode: 'auto',
        });
        if (opts.json) {
          outputJson({
            deviceId: session.deviceId,
            deviceName: session.deviceName,
            endpoint: session.endpoint,
            scopes: session.scopes,
          });
        } else {
          process.stderr.write(chalk.green(`  ✓ Paired as "${session.deviceName}"\n`));
          process.stderr.write(chalk.dim(`    device ${session.deviceId}\n\n`));
        }
      } catch (err) {
        process.stderr.write(
          chalk.red(`  ✗ Pairing failed: ${err instanceof Error ? err.message : String(err)}\n`),
        );
        process.exitCode = 1;
      }
    });

  // ── status ───────────────────────────────────────────────────────
  device
    .command('status')
    .description("Show this CLI's credential and where its secrets are stored")
    .option('--json', 'Output JSON')
    .action(async (opts: { json?: boolean }) => {
      const endpoint = await serverUrl(program.opts());
      const runtime = getCliAuthRuntime({
        endpoint,
        legacyApiKey: process.env['GENERATORAI_API_KEY'],
      });
      const state = await runtime.initialize();
      const backend = await describeCliSecretBackend();

      const data = {
        // The session remembers the endpoint it was paired against, which can
        // differ from the configured default (127.0.0.1 vs localhost).
        endpoint: runtime.endpoint,
        status: state.status,
        deviceId: state.status === 'authenticated' ? state.deviceId : null,
        scopes: state.status === 'authenticated' ? state.scopes : [],
        legacyApiKey: runtime.isLegacyKeyMode,
        secretBackend: backend.kind,
        secretBackendSecure: backend.secure,
        ...(backend.reason ? { secretBackendWarning: backend.reason } : {}),
      };

      if (opts.json) {
        outputJson(data);
        return;
      }
      outputRecord(data as unknown as Record<string, unknown>, {
        title: 'CLI credential',
        fields: [
          { key: 'endpoint', label: 'Server' },
          { key: 'status', label: 'Status' },
          { key: 'deviceId', label: 'Device' },
          { key: 'scopes', label: 'Scopes', format: (v) => (v as string[]).join(', ') || '—' },
          { key: 'secretBackend', label: 'Secret store' },
        ],
      });
      if (!backend.secure) {
        process.stderr.write(
          chalk.yellow(`\n  ⚠ ${backend.reason ?? 'Secrets are not protected by an OS keystore.'}\n`),
        );
      }
      if (runtime.isLegacyKeyMode) {
        process.stderr.write(
          chalk.yellow(
            '\n  ⚠ Using the deprecated GENERATORAI_API_KEY. It grants full access and cannot be\n' +
              '    revoked individually. Run `generatorai device pair <code>` instead.\n',
          ),
        );
      }
    });

  // ── forget ───────────────────────────────────────────────────────
  device
    .command('forget')
    .description("Delete this CLI's local credential (does not revoke it on the server)")
    .action(async () => {
      const endpoint = await serverUrl(program.opts());
      await getCliAuthRuntime({ endpoint }).forget();
      process.stderr.write(
        chalk.green('  ✓ Local credential removed.\n') +
          chalk.dim('    Run `generatorai device revoke <id>` on a trusted device to invalidate\n') +
          chalk.dim('    it server-side as well.\n'),
      );
    });

  // ── list ─────────────────────────────────────────────────────────
  device
    .command('list')
    .alias('ls')
    .description('List every device paired with the server')
    .option('--all', 'Include revoked devices')
    .option('--json', 'Output JSON')
    .action(async (opts: { all?: boolean; json?: boolean }) => {
      const { devices } = await adminRequest<{ devices: DeviceSummary[] }>(program, '/api/auth/devices');
      const rows = opts.all ? devices : devices.filter((d) => !d.revokedAt);
      if (opts.json) {
        outputJson(rows);
        return;
      }
      outputList(
        rows.map((d) => ({
          id: d.deviceId,
          name: d.name,
          platform: d.platform,
          scopes: String(d.scopes.length),
          lastSeen: fmtTime(d.lastSeenAt),
          state: d.revokedAt ? 'revoked' : 'active',
        })),
        [
          { key: 'name', label: 'Name' },
          { key: 'platform', label: 'Platform' },
          { key: 'scopes', label: '#Scopes' },
          { key: 'lastSeen', label: 'Last seen' },
          { key: 'state', label: 'State' },
          { key: 'id', label: 'Device ID' },
        ],
        { title: 'Paired devices', emptyMessage: 'No devices are paired.' },
      );
    });

  // ── revoke ───────────────────────────────────────────────────────
  device
    .command('revoke')
    .description('Revoke a device immediately')
    .argument('<deviceId>', 'Device ID from `device list`')
    .option('--json', 'Output JSON')
    .action(async (deviceId: string, opts: { json?: boolean }) => {
      await adminRequest(program, `/api/auth/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
      });
      if (opts.json) {
        outputJson({ deviceId, revoked: true });
        return;
      }
      process.stderr.write(chalk.green(`  ✓ Revoked ${deviceId}\n`));
      process.stderr.write(
        chalk.dim('    If it is connected through the relay, revocation is queued and delivered\n') +
          chalk.dim('    as soon as the relay is reachable.\n'),
      );
    });

  // ── invite ───────────────────────────────────────────────────────
  device
    .command('invite')
    .description('Create a pairing code for a new device')
    .option('--name <name>', 'Name for the new device', 'New device')
    .option(
      '--platform <platform>',
      'web | desktop | cli | mobile | other',
      'other',
    )
    .option('--scopes <scopes>', 'Comma-separated scopes (defaults to the platform preset)')
    .option('--relay', 'Include relay access so the device can connect from outside the network')
    .option('--json', 'Output JSON')
    .action(
      async (opts: {
        name: string;
        platform: string;
        scopes?: string;
        relay?: boolean;
        json?: boolean;
      }) => {
        const result = await adminRequest<{
          grantId: string;
          expiresAt: number;
          requestedScopes: string[];
          pairingCode: string;
          pairingUrl: string;
        }>(program, '/api/auth/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceName: opts.name,
            platform: opts.platform,
            ...(opts.scopes ? { scopes: opts.scopes.split(',').map((s) => s.trim()) } : {}),
            ...(opts.relay ? { includeRelay: true } : {}),
          }),
        });

        if (opts.json) {
          outputJson(result);
          return;
        }
        const minutes = Math.max(1, Math.round((result.expiresAt - Date.now()) / 60_000));
        process.stderr.write(chalk.bold('\n  Pairing code\n\n'));
        process.stdout.write(`${result.pairingUrl}\n`);
        process.stderr.write(
          chalk.dim(`\n  scopes   ${result.requestedScopes.join(', ')}\n`) +
            chalk.dim(`  expires  in ${minutes} minute${minutes === 1 ? '' : 's'} (single use)\n`) +
            chalk.yellow(
              '\n  Anyone who sees this code can pair a device with those scopes.\n' +
                '  Do not paste it into a chat or a shared terminal.\n\n',
            ),
        );
      },
    );

  // ── audit ────────────────────────────────────────────────────────
  device
    .command('audit')
    .description('Show recent security audit events')
    .option('--limit <n>', 'How many events', '50')
    .option('--json', 'Output JSON')
    .action(async (opts: { limit: string; json?: boolean }) => {
      const { events } = await adminRequest<{
        events: Array<{
          timestamp: number;
          action: string;
          result: string;
          actorDisplayName: string | null;
          resourceType: string | null;
          resourceId: string | null;
          reasonCode: string | null;
          severity: string;
        }>;
      }>(program, `/api/auth/audit?limit=${encodeURIComponent(opts.limit)}`);

      if (opts.json) {
        outputJson(events);
        return;
      }
      outputList(
        events.map((e) => ({
          when: fmtTime(e.timestamp),
          action: e.action,
          result: e.result,
          actor: e.actorDisplayName ?? '—',
          resource: e.resourceId ? `${e.resourceType ?? ''}:${e.resourceId}` : '—',
          reason: e.reasonCode ?? '',
        })),
        [
          { key: 'when', label: 'When' },
          { key: 'action', label: 'Action' },
          { key: 'result', label: 'Result' },
          { key: 'actor', label: 'Actor' },
          { key: 'resource', label: 'Resource' },
          { key: 'reason', label: 'Reason' },
        ],
        { title: 'Security audit', emptyMessage: 'No audit events recorded.' },
      );
    });
}
