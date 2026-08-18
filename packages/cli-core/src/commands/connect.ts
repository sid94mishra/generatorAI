// `generatorai connect …`, `device …` and `config …`
//
// These three are the commands that must work when nothing else does: before
// a credential exists, before a server is reachable, and when the config
// itself is what is broken. None of them may require a working API client.

import { z } from 'zod';
import { defineCommand, type CommandSpec } from '../registry/CommandSpec.js';
import { CliError } from '../errors/CliError.js';
import {
  ConnectionManager,
  hostLabel,
  probeEndpoint,
  resolveEndpoint,
} from '../connection/ConnectionManager.js';
import {
  getConfigValue,
  readUserConfig,
  saveUserConfig,
  setConfigValue,
} from '../config/loadConfig.js';
import { getUserConfigFilePath } from '../config/paths.js';
import { CliConfigSchema } from '../config/schema.js';
import { DEFAULT_KEYMAP } from '../keymap/Keymap.js';
import { inputSchema, list, ok, record } from './_shared.js';

/**
 * Masks the deprecated shared API key.
 *
 * `config show` output routinely ends up in scrollback, shell pipelines and
 * CI logs, and that key grants full access to the server. Everything else in
 * the CLI is written never to print a secret; this was the one hole.
 */
function redactSecrets<T extends { server: { apiKey?: string | undefined } }>(config: T): T {
  const key = config.server.apiKey;
  if (!key) return config;
  const masked = key.length > 4 ? `…${key.slice(-4)}` : '…';
  return { ...config, server: { ...config.server, apiKey: `[redacted ${masked}]` } };
}

export const CONNECT_GROUP = {
  name: 'connect',
  summary: 'Servers this CLI knows about, and which one it is talking to',
  order: 1,};

export const CONFIG_GROUP = {
  name: 'config',
  summary: 'Configuration, profiles and key bindings',
  order: 95,
};

export function connectCommands(): CommandSpec[] {
  return [
    defineCommand({
      id: 'connect.list',
      group: 'connect',
      verb: 'list',
      aliases: ['ls'],
      summary: 'Servers this CLI can reach',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'active', header: '', priority: 0, width: 1 },
          { key: 'label', header: 'Label', priority: 0 },
          { key: 'endpoint', header: 'Endpoint', priority: 0 },
          { key: 'kind', header: 'Kind', priority: 1 },
          { key: 'serverId', header: 'Server ID', format: 'id', priority: 3 },
          { key: 'lastConnectedAt', header: 'Last used', format: 'relative', priority: 2 },
        ],
      },
      async handler() {
        const manager = new ConnectionManager();
        const active = manager.active();
        return list(
          manager.list().map((c) => ({
            active: c.serverId === active?.serverId ? '●' : ' ',
            label: c.label,
            endpoint: c.endpoint,
            kind: c.kind,
            serverId: c.serverId,
            lastConnectedAt: c.lastConnectedAt,
            routes: c.endpoints.length,
            managed: c.managed,
          })),
        );
      },
    }),

    defineCommand({
      id: 'connect.add',
      group: 'connect',
      verb: 'add',
      summary: 'Register a server and make it active',
      requiresServer: false,
      sinceVersion: '0.2.0',
      examples: ['generatorai connect add https://box.lan:3100 --label workstation'],
      args: [{ name: 'url', description: 'Server URL', required: true }],
      flags: [
        { name: 'label', description: 'Friendly name; defaults to the hostname', type: 'string' },
        { name: 'local', description: 'Mark as running on this machine', type: 'boolean' },
      ],
      schema: inputSchema(
        { url: z.string().url('must be a URL, e.g. https://host:3100') },
        { label: z.string().optional(), local: z.boolean().optional() },
      ),
      output: { kind: 'record', successMessage: 'Added {label}' },
      async handler(_ctx, { args, flags }) {
        const endpoint = args.url.replace(/\/$/, '');
        const probe = await probeEndpoint(endpoint);
        if (!probe.ok) {
          throw new CliError('UNAVAILABLE', `Could not reach ${endpoint}: ${probe.error}`, {
            hint: 'The server must be running to be added — its identity key is what the credential is pinned to.',
          });
        }
        if (!probe.serverId) {
          throw new CliError('VERSION_MISMATCH', `${endpoint} did not advertise a server identity.`, {
            hint: 'This server predates device pairing. Upgrade it, or use --api-key.',
          });
        }

        const manager = new ConnectionManager();
        const connection = {
          serverId: probe.serverId,
          label: flags.label ?? probe.serverName ?? hostLabel(endpoint),
          endpoint,
          endpoints: [endpoint],
          kind: (flags.local ? 'local' : 'remote') as 'local' | 'remote',
          managed: false,
          lastConnectedAt: Date.now(),
        };
        manager.upsert(connection);

        return {
          data: connection,
          message: `Added "${connection.label}" and made it active.`,
          warnings: ['Not paired yet — run `generatorai device pair <code>` to get a credential.'],
        };
      },
    }),

    defineCommand({
      id: 'connect.use',
      group: 'connect',
      verb: 'use',
      aliases: ['switch'],
      summary: 'Switch the active server',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [{ name: 'connection', description: 'Label, server id or URL', required: true, completes: 'connection' }],
      flags: [],
      schema: inputSchema({ connection: z.string() }, {}),
      output: { kind: 'record', successMessage: 'Now using {label}' },
      async handler(_ctx, { args }) {
        const manager = new ConnectionManager();
        const target = manager.require(args.connection);
        manager.setActive(target.serverId);
        return record(target, `Now using "${target.label}".`);
      },
    }),

    defineCommand({
      id: 'connect.test',
      group: 'connect',
      verb: 'test',
      summary: 'Probe every known route to a server',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [{ name: 'connection', description: 'Label or id; omit for the active one', required: false, completes: 'connection' }],
      flags: [],
      schema: inputSchema({ connection: z.string().optional() }, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'endpoint', header: 'Route', priority: 0 },
          { key: 'ok', header: 'OK', format: 'boolean', priority: 0 },
          { key: 'latencyMs', header: 'Latency', format: 'duration', priority: 1 },
          { key: 'error', header: 'Error', priority: 2 },
        ],
      },
      async handler(ctx, { args }) {
        const manager = new ConnectionManager();
        const target = args.connection ? manager.require(args.connection) : manager.active();

        // Before the first pairing there is no saved connection, and "no
        // connection is configured" is unhelpful when the user has just told
        // us the address with --server. Probe what they asked about.
        //
        // `ctx.baseUrl` is empty here: this command declares
        // `requiresServer: false`, so no client was built to resolve one.
        if (!target) {
          const endpoint = (ctx.baseUrl || ctx.config.server.url).replace(/\/$/, '');
          const probe = await probeEndpoint(endpoint);
          return {
            data: [probe],
            warnings: probe.ok
              ? [`${endpoint} answered, but is not saved. Add it with \`generatorai connect add\`.`]
              : [],
            ...(probe.ok ? {} : { exitCode: 1 }),
          };
        }

        const routes = [target.endpoint, ...target.endpoints.filter((e) => e !== target.endpoint)];
        const results = [];
        for (const route of routes) {
          const probe = await probeEndpoint(route);
          results.push(probe);
          // A server whose identity has changed is the one failure that must
          // not be reported as a routine "ok" — it is the impersonation case.
          if (probe.ok && probe.serverId && probe.serverId !== target.serverId) {
            return {
              data: results,
              warnings: [
                `${route} answered with a DIFFERENT server identity (${probe.serverId.slice(0, 12)}…).`,
                'Do not pair again unless you expected this server to be reinstalled.',
              ],
              exitCode: 1,
            };
          }
        }
        return list(results);
      },
    }),

    defineCommand({
      id: 'connect.rename',
      group: 'connect',
      verb: 'rename',
      summary: 'Rename a connection',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [
        { name: 'connection', description: 'Label or id', required: true, completes: 'connection' },
        { name: 'label', description: 'New label', required: true },
      ],
      flags: [],
      schema: inputSchema({ connection: z.string(), label: z.string().min(1) }, {}),
      output: { kind: 'void', successMessage: 'Renamed.' },
      async handler(_ctx, { args }) {
        const manager = new ConnectionManager();
        const target = manager.require(args.connection);
        manager.rename(target.serverId, args.label);
        return ok(`Renamed to "${args.label}".`);
      },
    }),

    defineCommand({
      id: 'connect.remove',
      group: 'connect',
      verb: 'remove',
      aliases: ['rm'],
      summary: 'Forget a server',
      requiresServer: false,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'connection', description: 'Label or id', required: true, completes: 'connection' }],
      flags: [],
      schema: inputSchema({ connection: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Removed.' },
      async handler(_ctx, { args }) {
        const manager = new ConnectionManager();
        const target = manager.require(args.connection);
        manager.remove(target.serverId);
        return {
          data: null,
          message: `Removed "${target.label}".`,
          warnings: ['Its credential is still in the vault. Run `generatorai device forget` to clear it.'],
        };
      },
    }),

    defineCommand({
      id: 'connect.endpoint.add',
      group: 'connect',
      verb: 'endpoint add',
      summary: 'Add another route to the same server',
      requiresServer: false,
      sinceVersion: '0.2.0',
      examples: ['generatorai connect endpoint add workstation http://192.168.0.107:3100'],
      args: [
        { name: 'connection', description: 'Label or id', required: true, completes: 'connection' },
        { name: 'url', description: 'Additional URL', required: true },
      ],
      flags: [],
      schema: inputSchema({ connection: z.string(), url: z.string().url() }, {}),
      output: { kind: 'void', successMessage: 'Route added.' },
      async handler(_ctx, { args }) {
        const manager = new ConnectionManager();
        const target = manager.require(args.connection);
        const probe = await probeEndpoint(args.url);
        if (probe.ok && probe.serverId && probe.serverId !== target.serverId) {
          throw new CliError('CONFLICT', `${args.url} is a different server.`, {
            hint: 'Routes on one connection must all reach the same host identity.',
            suggestions: [`generatorai connect add ${args.url}`],
          });
        }
        manager.addEndpoint(target.serverId, args.url);
        return ok(`Added route ${args.url}.`);
      },
    }),

    defineCommand({
      id: 'connect.endpoint.remove',
      group: 'connect',
      verb: 'endpoint remove',
      summary: 'Remove a route',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [
        { name: 'connection', description: 'Label or id', required: true, completes: 'connection' },
        { name: 'url', description: 'Route to remove', required: true },
      ],
      flags: [],
      schema: inputSchema({ connection: z.string(), url: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Route removed.' },
      async handler(_ctx, { args }) {
        const manager = new ConnectionManager();
        const target = manager.require(args.connection);
        manager.removeEndpoint(target.serverId, args.url);
        return ok(`Removed route ${args.url}.`);
      },
    }),

    defineCommand({
      id: 'connect.resolve',
      group: 'connect',
      verb: 'resolve',
      hidden: true,
      summary: 'Print the route that answers for a connection',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [{ name: 'connection', description: 'Label or id', required: false, completes: 'connection' }],
      flags: [],
      schema: inputSchema({ connection: z.string().optional() }, {}),
      output: { kind: 'record' },
      async handler(_ctx, { args }) {
        const manager = new ConnectionManager();
        const target = args.connection ? manager.require(args.connection) : manager.active();
        if (!target) throw new CliError('USAGE', 'No connection is configured.');
        const resolved = await resolveEndpoint(target);
        if (!resolved) {
          throw new CliError('UNAVAILABLE', `No route to "${target.label}" answered.`, {
            suggestions: [`generatorai connect test ${target.label}`],
          });
        }
        return record(resolved);
      },
    }),
  ];
}

export function configCommands(): CommandSpec[] {
  return [
    defineCommand({
      id: 'config.show',
      group: 'config',
      verb: 'show',
      summary: 'Resolved configuration after all five layers',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [],
      flags: [
        { name: 'sources', description: 'Show where each layer came from', type: 'boolean' },
        { name: 'reveal', description: 'Print secrets in full instead of redacting', type: 'boolean' },
      ],
      schema: inputSchema({}, { sources: z.boolean().optional(), reveal: z.boolean().optional() }),
      output: { kind: 'record' },
      async handler(ctx, { flags }) {
        const config = flags.reveal ? ctx.config : redactSecrets(ctx.config);
        if (flags.sources) return record(config);
        const { sources: _sources, ...rest } = config;
        return record(rest);
      },
    }),

    defineCommand({
      id: 'config.get',
      group: 'config',
      verb: 'get',
      summary: 'Read one setting',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [{ name: 'key', description: 'Dotted key, e.g. tui.theme', required: true }],
      flags: [
        { name: 'reveal', description: 'Print secrets in full instead of redacting', type: 'boolean' },
      ],
      schema: inputSchema({ key: z.string() }, { reveal: z.boolean().optional() }),
      output: { kind: 'raw' },
      async handler(ctx, { args, flags }) {
        const source = flags.reveal ? ctx.config : redactSecrets(ctx.config);
        const value = getConfigValue(source, args.key);
        if (value === undefined) {
          throw CliError.notFound('config key', args.key, {
            suggestions: ['generatorai config show'],
          });
        }
        return record(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
      },
    }),

    defineCommand({
      id: 'config.set',
      group: 'config',
      verb: 'set',
      summary: 'Write one setting to the user config',
      requiresServer: false,
      sinceVersion: '0.2.0',
      examples: ['generatorai config set tui.theme gruvbox', 'generatorai config set cli.pageSize 100'],
      args: [
        { name: 'key', description: 'Dotted key', required: true },
        { name: 'value', description: 'New value', required: true },
      ],
      flags: [],
      schema: inputSchema({ key: z.string(), value: z.string() }, {}),
      output: { kind: 'record', successMessage: 'Saved.' },
      async handler(_ctx, { args }) {
        const current = await readUserConfig();
        const updated = setConfigValue(current, args.key, args.value);
        const file = await saveUserConfig(updated);
        return record(
          { key: args.key, value: getConfigValue(updated, args.key), file },
          `Set ${args.key} in ${file}.`,
        );
      },
    }),

    defineCommand({
      id: 'config.unset',
      group: 'config',
      verb: 'unset',
      summary: 'Restore one setting to its default',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [{ name: 'key', description: 'Dotted key', required: true }],
      flags: [],
      schema: inputSchema({ key: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Restored to default.' },
      async handler(_ctx, { args }) {
        const current = await readUserConfig() as unknown as Record<string, unknown>;
        const parts = args.key.split('.');
        let node: Record<string, unknown> | undefined = current;
        for (const part of parts.slice(0, -1)) {
          node = node?.[part] as Record<string, unknown> | undefined;
          if (!node) break;
        }
        if (node) delete node[parts.at(-1)!];
        // Re-parse so the schema reinstates the default rather than leaving a
        // hole that would fail validation on the next load.
        await saveUserConfig(CliConfigSchema.parse(current));
        return ok(`${args.key} restored to its default.`);
      },
    }),

    defineCommand({
      id: 'config.reset',
      group: 'config',
      verb: 'reset',
      summary: 'Reset the user config to defaults',
      requiresServer: false,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: { kind: 'void', successMessage: 'Reset.' },
      async handler() {
        const file = await saveUserConfig(CliConfigSchema.parse({}));
        return ok(`Reset ${file}. The previous file is at ${file}.bak.`);
      },
    }),

    defineCommand({
      id: 'config.path',
      group: 'config',
      verb: 'path',
      summary: 'Print the user config file path',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: { kind: 'raw' },
      async handler() {
        return record(getUserConfigFilePath());
      },
    }),

    defineCommand({
      id: 'config.profile.list',
      group: 'config',
      verb: 'profile list',
      summary: 'Named config profiles',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'active', header: '', priority: 0, width: 1 },
          { key: 'name', header: 'Profile', priority: 0 },
          { key: 'overrides', header: 'Overrides', priority: 1 },
        ],
      },
      async handler(ctx) {
        const config = await readUserConfig();
        return list(
          Object.entries(config.profiles).map(([name, overrides]) => ({
            active: name === ctx.config.activeProfile ? '●' : ' ',
            name,
            overrides: Object.keys(overrides).join(', ') || '—',
          })),
        );
      },
    }),

    defineCommand({
      id: 'config.profile.create',
      group: 'config',
      verb: 'profile create',
      summary: 'Create a profile from the current settings',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [{ name: 'name', description: 'Profile name', required: true }],
      flags: [],
      schema: inputSchema({ name: z.string().min(1) }, {}),
      output: { kind: 'void', successMessage: 'Created.' },
      async handler(_ctx, { args }) {
        const config = await readUserConfig();
        if (config.profiles[args.name]) {
          throw new CliError('CONFLICT', `Profile "${args.name}" already exists.`);
        }
        config.profiles[args.name] = { server: { url: config.server.url } };
        await saveUserConfig(config);
        return ok(`Created profile "${args.name}".`);
      },
    }),

    defineCommand({
      id: 'config.profile.use',
      group: 'config',
      verb: 'profile use',
      summary: 'Make a profile active',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [{ name: 'name', description: 'Profile name', required: true, completes: 'profile' }],
      flags: [],
      schema: inputSchema({ name: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Active.' },
      async handler(_ctx, { args }) {
        const config = await readUserConfig();
        if (!config.profiles[args.name]) {
          throw CliError.notFound('profile', args.name, {
            hint: `Available: ${Object.keys(config.profiles).join(', ') || 'none'}`,
          });
        }
        config.activeProfile = args.name;
        await saveUserConfig(config);
        return ok(`Now using profile "${args.name}".`);
      },
    }),

    defineCommand({
      id: 'config.profile.delete',
      group: 'config',
      verb: 'profile delete',
      aliases: ['profile rm'],
      summary: 'Delete a profile',
      requiresServer: false,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'name', description: 'Profile name', required: true, completes: 'profile' }],
      flags: [],
      schema: inputSchema({ name: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Deleted.' },
      async handler(_ctx, { args }) {
        const config = await readUserConfig();
        if (!config.profiles[args.name]) throw CliError.notFound('profile', args.name);
        delete config.profiles[args.name];
        if (config.activeProfile === args.name) delete config.activeProfile;
        await saveUserConfig(config);
        return ok(`Deleted profile "${args.name}".`);
      },
    }),

    defineCommand({
      id: 'config.keymap.list',
      group: 'config',
      verb: 'keymap list',
      summary: 'Every key binding and its id',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [],
      flags: [{ name: 'context', description: 'Filter by context', type: 'string' }],
      schema: inputSchema({}, { context: z.string().optional() }),
      output: {
        kind: 'list',
        columns: [
          { key: 'id', header: 'Action', priority: 0 },
          { key: 'keys', header: 'Keys', priority: 0 },
          { key: 'context', header: 'Context', priority: 1 },
          { key: 'description', header: 'Description', priority: 1 },
          { key: 'customised', header: 'Custom', format: 'boolean', priority: 2 },
        ],
      },
      async handler(ctx, { flags }) {
        const overrides = ctx.config.keymap;
        return list(
          DEFAULT_KEYMAP.filter((b) => !flags.context || b.context === flags.context).map((b) => ({
            ...b,
            keys: overrides[b.id] ?? b.keys,
            customised: Boolean(overrides[b.id]),
          })),
        );
      },
    }),

    defineCommand({
      id: 'config.keymap.set',
      group: 'config',
      verb: 'keymap set',
      summary: 'Remap a key binding',
      requiresServer: false,
      sinceVersion: '0.2.0',
      examples: ['generatorai config keymap set app.palette ctrl+shift+p'],
      args: [
        { name: 'action', description: 'Binding id', required: true },
        { name: 'keys', description: 'New chord', required: true },
      ],
      flags: [],
      schema: inputSchema({ action: z.string(), keys: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Remapped.' },
      async handler(_ctx, { args }) {
        if (!DEFAULT_KEYMAP.some((b) => b.id === args.action)) {
          throw CliError.notFound('key binding', args.action, {
            suggestions: ['generatorai config keymap list'],
          });
        }
        const config = await readUserConfig();
        config.keymap[args.action] = args.keys;
        await saveUserConfig(config);
        return ok(`${args.action} → ${args.keys}`);
      },
    }),
  ];
}
