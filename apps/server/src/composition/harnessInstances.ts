// ────────────────────────────────────────────────────────────────
// harnessInstances — W34: load persisted provider instances (accounts) and
// register them with the live routing stack.
//
// `harness_instances` (SqliteHarnessInstanceRepository) and
// `ProviderInstanceRegistry` both existed already but were never connected
// to anything — `HarnessRegistry`/`MultiHarness` only ever held one adapter
// per DRIVER TYPE, so a second row in this table could never actually run.
// That structural ceiling is fixed (see `HarnessRegistry.registerInstance`/
// `.getInstance` and `MultiHarness.setInstanceRegistry`); this module is the
// missing wiring that turns a `harness_instances` row into a live,
// independently-routable adapter.
//
// Additive by construction: a deployment with zero rows in `harness_instances`
// (every deployment today, since nothing has ever written to it) registers
// nothing here, and every conversation continues to route exactly as it did
// before this file existed — through `HarnessRegistry.get(type)`, the single
// shared adapter per driver. This only activates once something inserts a
// row (there is deliberately no UI/API for that yet; adding one is a
// separate, larger feature than "make the routing layer capable of it").
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import type { SqliteHarnessInstanceRepository, HarnessInstanceRecord } from '@generatorai/db';
import { parseSecretRef, type SecretStore } from '@generatorai/secrets';
import { makeProviderInstanceId, type ProviderWireProtocol } from '@generatorai/core';
import {
  ProviderInstanceRegistry,
  type HarnessRegistry,
  type HarnessType,
  type HarnessProviderConfig,
  type ProviderInstanceStore,
} from '@generatorai/agent-harness-providers';

const KNOWN_DRIVER_TYPES: readonly HarnessType[] = ['copilot', 'claude-agent', 'codex', 'opencode', 'acp'];

function isKnownDriverType(v: string): v is HarnessType {
  return (KNOWN_DRIVER_TYPES as readonly string[]).includes(v);
}

/** Wire protocol for a driver type — every instance of a driver uses that driver's one protocol today (N-4 leaves room for more later). */
function protocolFor(driverType: HarnessType): ProviderWireProtocol {
  switch (driverType) {
    case 'copilot': return 'copilot-sdk';
    case 'claude-agent': return 'claude-agent-sdk';
    case 'codex': return 'codex-rpc';
    case 'opencode': return 'opencode-http';
    case 'acp': return 'acp';
  }
}

/**
 * Resolves one credential field from `record.credentialRefs[fieldName]`
 * (a full `SecretRef` string, e.g. `harness/<id>/githubToken` — see
 * `HarnessInstanceRepository`'s own doc comment) via the secret store.
 * Returns `undefined` when the field isn't declared or the secret is absent
 * — never throws, since a missing optional credential (e.g. ACP agents that
 * need none) is not an error.
 */
async function resolveCredential(
  record: HarnessInstanceRecord,
  fieldName: string,
  secretStore: SecretStore,
): Promise<string | undefined> {
  const ref = record.credentialRefs[fieldName];
  if (!ref) return undefined;
  const parsed = parseSecretRef(ref);
  if (!parsed) return undefined;
  const bytes = await secretStore.get(parsed.namespace, parsed.name);
  return bytes ? Buffer.from(bytes).toString('utf8') : undefined;
}

/**
 * Builds the driver-specific `HarnessProviderConfig` for one persisted
 * instance. `record.config` is the driver-validated JSON blob the
 * `HarnessInstanceRepository` doc comment describes — read here via a small,
 * intentionally narrow set of well-known keys per driver rather than a
 * generic passthrough, so a malformed/unexpected key in that JSON can never
 * silently become an unintended provider option.
 */
export async function buildInstanceProviderConfig(
  record: HarnessInstanceRecord,
  secretStore: SecretStore,
  opts: { artifactsDir: string; supervisor?: unknown },
): Promise<HarnessProviderConfig | null> {
  if (!isKnownDriverType(record.driverType)) return null;
  const type = record.driverType;
  const cfg = record.config as Record<string, unknown>;
  const readString = (key: string): string | undefined =>
    typeof cfg[key] === 'string' ? (cfg[key] as string) : undefined;
  const readStringArray = (key: string): string[] | undefined =>
    Array.isArray(cfg[key]) && cfg[key]!.every((v) => typeof v === 'string') ? (cfg[key] as string[]) : undefined;

  switch (type) {
    case 'copilot': {
      const githubToken = await resolveCredential(record, 'githubToken', secretStore);
      return {
        type,
        copilot: {
          defaultModel: record.defaultModel ?? undefined,
          defaultCwd: opts.artifactsDir,
          homeDir: record.homeDirectory ?? undefined,
          githubToken,
          githubHost: readString('githubHost'),
          cliPath: readString('cliPath'),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          supervisor: opts.supervisor as any,
        },
      };
    }
    case 'claude-agent': {
      return {
        type,
        claudeAgent: {
          defaultModel: record.defaultModel ?? undefined,
          defaultCwd: opts.artifactsDir,
          homeDir: record.homeDirectory ?? undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          supervisor: opts.supervisor as any,
        },
      };
    }
    case 'codex': {
      const apiKey = await resolveCredential(record, 'apiKey', secretStore);
      return {
        type,
        codex: {
          defaultModel: record.defaultModel ?? undefined,
          defaultCwd: opts.artifactsDir,
          binaryPath: readString('binaryPath'),
          // Codex runs model-authored commands. Both of these are declared
          // rather than left to the binary's own config file, so what the
          // sandbox permits is a property of this instance row.
          approvalPolicy: readString('approvalPolicy') as
            | 'untrusted' | 'on-request' | 'never' | undefined,
          sandboxMode: readString('sandboxMode') as
            | 'read-only' | 'workspace-write' | 'danger-full-access' | undefined,
          env: apiKey ? { OPENAI_API_KEY: apiKey } : undefined,
        },
      };
    }
    case 'opencode': {
      const authToken = await resolveCredential(record, 'authToken', secretStore);
      const baseUrl = readString('baseUrl');
      return {
        type,
        opencode: {
          // No invented default: `opencode serve` binds an ephemeral port, so
          // an instance row with no baseUrl means "start one and read the
          // address back", not "try 4096 and report it unreachable".
          baseUrl,
          autoStart: baseUrl ? false : true,
          binaryPath: readString('binaryPath'),
          defaultModel: record.defaultModel ?? undefined,
          // Model ids are `providerID/modelID`; this qualifies a bare one.
          defaultProviderId: readString('defaultProviderId'),
          authToken,
        },
      };
    }
    case 'acp': {
      const command = readString('command');
      if (!command) return null; // acp.command is required; a row without one can't be started.
      const apiKey = await resolveCredential(record, 'apiKey', secretStore);
      return {
        type,
        acp: {
          command,
          args: readStringArray('args'),
          defaultCwd: opts.artifactsDir,
          env: apiKey ? { GENERATORAI_ACP_API_KEY: apiKey } : undefined,
        },
      };
    }
  }
}

export interface RegisterHarnessInstancesOptions {
  harnessRegistry: HarnessRegistry;
  instanceRepo: SqliteHarnessInstanceRepository;
  secretStore: SecretStore;
  artifactsDir: string;
  /** Passed through to copilot/claude-agent instance configs (cold-start gating). */
  supervisor?: unknown;
  logger?: Pick<ILogger, 'info' | 'warn'>;
  /**
   * Durable conversation→instance ownership store (see
   * `SqliteConversationInstanceOwnershipRepository`, migration v40). The
   * returned registry does NOT hydrate itself — call `.hydrate()` once this
   * function resolves, alongside `multiHarness.hydrate()`.
   */
  ownershipStore?: ProviderInstanceStore;
}

/**
 * Reads every ENABLED row from `harness_instances`, builds its provider
 * config, and registers it with `HarnessRegistry` + a fresh
 * `ProviderInstanceRegistry`. Returns the populated registry so the caller
 * can wire it into `MultiHarness.setInstanceRegistry(...)` and hydrate its
 * conversation-ownership store.
 *
 * Never throws for a single bad row — logs and skips it so one misconfigured
 * instance cannot take the whole server down at boot.
 */
export async function registerHarnessInstances(
  opts: RegisterHarnessInstancesOptions,
): Promise<ProviderInstanceRegistry> {
  const { harnessRegistry, instanceRepo, secretStore, logger } = opts;
  const instanceRegistry = new ProviderInstanceRegistry(opts.ownershipStore);
  const records = await instanceRepo.list();

  for (const record of records) {
    if (!record.enabled) continue;
    try {
      const config = await buildInstanceProviderConfig(record, secretStore, {
        artifactsDir: opts.artifactsDir,
        supervisor: opts.supervisor,
      });
      if (!config) {
        logger?.warn(`[harnessInstances] Skipping '${record.instanceId}': unknown driver type or incomplete config ('${record.driverType}')`);
        continue;
      }
      const instanceId = makeProviderInstanceId(record.instanceId);
      const driverType = record.driverType as HarnessType;
      harnessRegistry.registerInstance(instanceId, driverType, config);
      instanceRegistry.register({
        id: instanceId,
        driverType,
        protocol: protocolFor(driverType),
        displayName: record.displayName,
        capabilities: {
          vision: false, reasoning: false, reasoningEfforts: [], planMode: false,
          mcpServers: false, skillDirectories: false, fullToolGating: false,
          sessionPersistence: false, budgetTracking: false,
        },
        enabled: true,
      });
      logger?.info(`[harnessInstances] Registered instance '${record.instanceId}' (${record.driverType})`);
    } catch (err) {
      logger?.warn(`[harnessInstances] Failed to register instance '${record.instanceId}': ${String(err)}`);
    }
  }

  return instanceRegistry;
}
