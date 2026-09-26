// ────────────────────────────────────────────────────────────────
// Remote mode: the MCP server talks to the RUNNING GeneratorAI server as a
// paired device of platform `mcp` (P04 WP-4.4; PD-22).
//
// Pairing reuses device pairing (no service-account issuance): an operator
// runs `generatorai device invite --platform mcp` (the mcp default grant:
// read:status, read:workflows, stream:events, exec:agent, read:chats,
// write:chats; add `--scopes …,write:workflows` to let it draft), then
// `generatorai-mcp pair <code>` redeems it here. The device key and session
// live in the encrypted vault of `@generatorai/secrets` (namespace
// `mcp/<serverId>`), never in a plaintext file; `mcp-connection.json`
// remembers which server was paired and which key backend sealed the vault.
// The device is listed and revocable in Settings → Devices like any other.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AuthenticatedClientRuntime,
  parsePairingCode,
  resolveShortPairingCode,
  SecretSinkDeviceKeyStore,
  SecretSinkSessionStore,
  type PairingConsent,
  type SecretSink,
} from '@generatorai/client-runtime';
import { createAdminApi, createApiClient } from '@generatorai/client-core';
import { createSecretStore, EnvKeyProvider, type SecretStore } from '@generatorai/secrets';
import { isPairingCode } from '@generatorai/shared';
import type { AiFacade } from './server.js';

/** The server this MCP server is paired with. */
export interface McpConnection {
  endpoint: string;
  endpoints?: string[];
  serverId: string;
  serverName?: string;
  /**
   * The key backend that sealed the vault at pairing (`env-key`,
   * `env-passphrase` or `local-file-key`). An MCP client spawns this process
   * with its own environment, so a pairing made in a shell that had
   * `GENERATORAI_SECRET_KEY` set cannot be opened from one that has not
   * (and vice versa): pinned here so that is a clear error, not INTEGRITY.
   */
  secretBackend: string;
}

/** The key backend `createSecretStore` picks in this environment (its selection order, minus the desktop-only OS hooks). */
export function secretBackendKind(): string {
  return EnvKeyProvider.isConfigured() ? new EnvKeyProvider('').info().kind : 'local-file-key';
}

/** Refuses to open the vault with a different key backend than the one that sealed it. */
export function assertSecretBackend(connection: McpConnection): void {
  const current = secretBackendKind();
  if (connection.secretBackend === current) return;
  const envHint = (kind: string | undefined): string =>
    kind === 'env-key'
      ? 'GENERATORAI_SECRET_KEY set'
      : kind === 'env-passphrase'
        ? 'GENERATORAI_SECRET_PASSPHRASE set'
        : 'neither GENERATORAI_SECRET_KEY nor GENERATORAI_SECRET_PASSPHRASE set';
  throw new Error(
    `This MCP server was paired with ${envHint(connection.secretBackend)} (secret backend "${connection.secretBackend ?? 'unknown'}"), ` +
      `but runs with ${envHint(current)} ("${current}"). Give the MCP client's server config the same environment ` +
      '(its `env` block), or pair again in this environment with `generatorai-mcp pair <code>`.',
  );
}

/** `GENERATORAI_MCP_CONFIG_DIR`, else `~/.generatorai/mcp`. */
export function mcpConfigDir(): string {
  const override = process.env['GENERATORAI_MCP_CONFIG_DIR'];
  return override ? path.resolve(override) : path.join(os.homedir(), '.generatorai', 'mcp');
}

const connectionFile = () => path.join(mcpConfigDir(), 'mcp-connection.json');

export function loadConnection(): McpConnection | null {
  try {
    return JSON.parse(fs.readFileSync(connectionFile(), 'utf8')) as McpConnection;
  } catch {
    return null;
  }
}

function saveConnection(connection: McpConnection): void {
  fs.mkdirSync(mcpConfigDir(), { recursive: true });
  fs.writeFileSync(connectionFile(), `${JSON.stringify(connection, null, 2)}\n`, { mode: 0o600 });
}

/** Adapts the vault's byte API to the string sink the Node stores expect. */
class VaultSink implements SecretSink {
  constructor(
    private readonly store: SecretStore,
    private readonly namespace: string,
  ) {}

  async get(name: string): Promise<string | null> {
    const value = await this.store.get(this.namespace, name);
    return value ? Buffer.from(value).toString('utf8') : null;
  }

  async set(name: string, value: string): Promise<void> {
    await this.store.set(this.namespace, name, Buffer.from(value, 'utf8'));
  }

  async remove(name: string): Promise<void> {
    await this.store.remove(this.namespace, name);
  }
}

/** The authenticated runtime of a paired MCP server (DPoP, refresh, endpoint pinning). */
export function createMcpRuntime(connection: McpConnection, endpoint = connection.endpoint): AuthenticatedClientRuntime {
  // Node has no OS-keychain backend here (only the desktop shell's
  // safeStorage hooks), the same as the CLI's own device key: the vault is
  // sealed by GENERATORAI_SECRET_KEY/PASSPHRASE when set, else by a 0600 key
  // file. Which one is pinned in the connection (`assertSecretBackend`).
  const store = createSecretStore({ dataDir: mcpConfigDir(), requireSecure: false });
  const sink = new VaultSink(store, `mcp/${connection.serverId}`);
  return new AuthenticatedClientRuntime({
    endpoint: endpoint.replace(/\/$/, ''),
    keyStore: new SecretSinkDeviceKeyStore(sink),
    sessionStore: new SecretSinkSessionStore(sink),
  });
}

/** The MCP server's slice of the remote API, over client-core: chats, the workflow tools, the skill bundle. */
export function remoteFacade(runtime: AuthenticatedClientRuntime): AiFacade {
  const fetchImpl = (p: string, init?: RequestInit) => runtime.fetch(p, init);
  const api = createApiClient(fetchImpl);
  const admin = createAdminApi(fetchImpl);
  return {
    chat: {
      list: async (status, projectId) => {
        const chats = await api.chats.list({
          ...(status === 'archived' ? { archived: true } : {}),
          ...(projectId ? { projectId } : {}),
        });
        return chats
          .filter((c) => !status || c.status === status)
          .map((c) => ({ id: c.id, name: c.name, status: c.status, projectId: c.projectId ?? null }));
      },
      create: async (options) => {
        const chat = await api.chats.create({ name: options.name, ...(options.projectId ? { projectId: options.projectId } : {}) });
        return { id: chat.id };
      },
      send: async (chatId, message) => {
        await api.chats.send(chatId, { message });
      },
    },
    workflowTools: {
      list: async () => (await admin.workflowTools.list()).tools,
      call: async (name, args, opts) => (await admin.workflowTools.call(name, args, opts)).result,
    },
    skill: {
      index: () => admin.definitions.skill(),
      file: (file) => admin.definitions.skillFile(file),
    },
  };
}

/**
 * Redeem a pairing code (the full code/URL, or a short code with
 * `GENERATORAI_URL` to resolve it against) as an `mcp` device, and remember
 * the server.
 */
export async function pairMcp(code: string, opts: { name?: string } = {}): Promise<{ consent: PairingConsent; deviceId: string | null }> {
  const trimmed = code.trim();
  let consent: PairingConsent;
  if (isPairingCode(trimmed)) {
    const origin = process.env['GENERATORAI_URL'] ?? loadConnection()?.endpoint;
    if (!origin) throw new Error('A short pairing code needs GENERATORAI_URL (the server that issued it); or paste the full code');
    consent = await resolveShortPairingCode(origin, trimmed);
  } else {
    consent = parsePairingCode(trimmed);
  }
  const connection: McpConnection = {
    endpoint: consent.endpoint,
    endpoints: consent.endpoints.map((e) => e.origin),
    serverId: consent.serverId,
    serverName: consent.serverName,
    secretBackend: secretBackendKind(),
  };
  const runtime = createMcpRuntime(connection);
  const session = await runtime.completePairing({
    endpoint: consent.endpoint,
    endpoints: connection.endpoints ?? [],
    serverId: consent.serverId,
    pairingToken: consent.pairingGrant,
    deviceName: opts.name ?? `${os.hostname()} (mcp)`,
    platform: 'mcp',
  });
  saveConnection(connection);
  return { consent, deviceId: (session as unknown as { deviceId?: string }).deviceId ?? null };
}
