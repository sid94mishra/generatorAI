// `generatorai system …` — health, models, artifacts, diagnostics.

import { z } from 'zod';
import { defineCommand, type CommandSpec } from '../registry/CommandSpec.js';
import { describeCapabilities } from '../capabilities/TerminalCapabilities.js';
import {
  checkProtocolCompatibility,
  probeEndpoint,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '../connection/ConnectionManager.js';
import { inputSchema, list, record } from './_shared.js';

export const SYSTEM_GROUP = {
  name: 'system',
  summary: 'Server health, models, artifacts and diagnostics',
  order: 90,
};

export function systemCommands(version = '0.0.0-dev'): CommandSpec[] {
  return [
    defineCommand({
      id: 'system.health',
      group: 'system',
      verb: 'health',
      aliases: ['status'],
      summary: 'Server uptime, database path and active counts',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: {
        kind: 'record',
        // `fieldsOnly` because `/api/health` is a diagnostic payload, not a
        // status line: it carries `harness`, `memory`, `flows` and `otel`
        // as nested objects, and the default record renderer appended every
        // one of them as raw indented JSON. The question this command answers
        // is "is my server up and busy?", so it now answers exactly that.
        // `--json` still returns the whole payload untouched.
        fieldsOnly: true,
        fields: [
          { key: 'status', header: 'Status', format: 'status' },
          { key: 'version', header: 'Version' },
          { key: 'uptime', header: 'Uptime', format: 'duration' },
          { key: 'harness.type', header: 'Harness' },
          { key: 'harness.healthy', header: 'Harness OK', format: 'boolean' },
          { key: 'db', header: 'Database', format: 'boolean' },
          { key: 'activeChats', header: 'Active chats' },
          { key: 'activeWorkflowRuns', header: 'Active runs' },
          { key: 'runningChats', header: 'Generating now' },
          { key: 'memory.rss', header: 'Memory (RSS)', format: 'bytes' },
          { key: 'admissionSummary', header: 'Admission' },
        ],
      },
      async handler(ctx) {
        const health = await ctx.api.health();
        const flows = (health as { flows?: Array<Record<string, unknown>> }).flows ?? [];
        // One line rather than a JSON array: a flow key matters when something
        // is running or queued, and that reads at a glance in this form.
        const admissionSummary = flows.length
          ? flows
              .map((f) => {
                const queued = Number(f['queued'] ?? 0);
                const limit = f['limit'] == null ? '∞' : String(Number(f['limit']));
                return `${String(f['flowKey'])} ${Number(f['running'] ?? 0)}/${limit}${queued > 0 ? ` (+${queued} queued)` : ''}`;
              })
              .join('  ')
          : undefined;
        const running = (health as { runningChatIds?: string[] }).runningChatIds ?? [];
        return record({
          ...health,
          // `/api/health` reports uptime in seconds; the duration formatter
          // takes milliseconds, so a two-minute-old server read as "120ms".
          uptime: health.uptime * 1000,
          runningChats: running.length,
          ...(admissionSummary ? { admissionSummary } : {}),
        });
      },
    }),

    defineCommand({
      id: 'system.config',
      group: 'system',
      verb: 'config',
      summary: 'Non-sensitive server configuration',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: { kind: 'record' },
      async handler(ctx) {
        return record(await ctx.api.healthConfig());
      },
    }),

    defineCommand({
      id: 'system.models',
      group: 'system',
      verb: 'models',
      summary: 'Models available from the active provider',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [
        {
          name: 'provider',
          description: 'Filter to one provider',
          type: 'string',
          choices: ['copilot', 'claude-agent'] as const,
        },
        { name: 'refresh', description: 'Re-probe providers instead of using the cache', type: 'boolean' },
      ],
      schema: inputSchema({}, { provider: z.string().optional(), refresh: z.boolean().optional() }),
      output: {
        kind: 'list',
        columns: [
          { key: 'id', header: 'Model', priority: 0 },
          { key: 'name', header: 'Name', priority: 1 },
          { key: 'provider', header: 'Provider', priority: 2 },
        ],
      },
      async handler(ctx, { flags }) {
        const providers = await ctx.api.harness.providers(Boolean(flags.refresh));
        const entries = (providers as { providers?: Array<{ type: string; models?: Array<{ id: string; name?: string }> }> })
          .providers ?? [];
        const rows = entries
          .filter((p) => !flags.provider || p.type === flags.provider)
          .flatMap((p) => (p.models ?? []).map((m) => ({ ...m, provider: p.type })));
        // Falls back to the flat model list when the providers payload has no
        // per-provider breakdown (older servers).
        if (rows.length === 0) {
          const flat = await ctx.api.harnessAdmin.models();
          return list(flat as Array<Record<string, unknown>>);
        }
        return list(rows);
      },
    }),

    defineCommand({
      id: 'system.artifacts',
      group: 'system',
      verb: 'artifacts',
      summary: 'System-scope skills, prompts and agents',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [
        {
          name: 'type',
          description: 'Artifact kind',
          type: 'string',
          choices: ['agent', 'prompt', 'skill'] as const,
        },
      ],
      schema: inputSchema({}, { type: z.enum(['agent', 'prompt', 'skill']).optional() }),
      output: {
        kind: 'list',
        columns: [
          { key: 'id', header: 'ID', format: 'id', priority: 0 },
          { key: 'name', header: 'Name', priority: 0 },
          { key: 'type', header: 'Type', priority: 1 },
          { key: 'scope', header: 'Scope', priority: 2 },
        ],
      },
      async handler(ctx, { flags }) {
        return list(await ctx.api.system.artifacts(flags.type));
      },
    }),

    defineCommand({
      id: 'system.artifact',
      group: 'system',
      verb: 'artifact',
      summary: 'Print one system artifact',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'id', description: 'Artifact id', required: true }],
      flags: [],
      schema: inputSchema({ id: z.string() }, {}),
      output: { kind: 'raw' },
      async handler(ctx, { args }) {
        const { content } = await ctx.api.system.artifactContent(args.id);
        return record(content);
      },
    }),

    defineCommand({
      id: 'system.mcpServers',
      group: 'system',
      verb: 'mcp-servers',
      summary: 'System-scope MCP servers',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'name', header: 'Name', priority: 0 },
          { key: 'type', header: 'Type', priority: 1 },
          { key: 'command', header: 'Command', priority: 2 },
        ],
      },
      async handler(ctx) {
        return list(await ctx.api.system.mcpServers());
      },
    }),

    defineCommand({
      id: 'system.version',
      group: 'system',
      verb: 'version',
      summary: 'CLI and server versions, and whether they are compatible',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: { kind: 'record' },
      async handler(ctx) {
        const payload: Record<string, unknown> = {
          cli: version,
          node: process.version,
          platform: `${process.platform}-${process.arch}`,
        };
        const warnings: string[] = [];
        if (ctx.connection) {
          const probe = await probeEndpoint(ctx.baseUrl);
          payload['endpoint'] = ctx.baseUrl;
          if (!probe.ok) {
            payload['server'] = `unreachable (${probe.error})`;
          } else {
            // `probe.protocolVersion` used to be read under the WRONG field
            // name (`probe.version`, which this response has never had), so
            // this command's own summary — "whether they are compatible" —
            // was never actually answered; it just printed "unknown" forever.
            payload['server'] = probe.serverName ?? 'unknown';
            payload['protocolVersion'] = probe.protocolVersion ?? 'unknown';
            const compat = checkProtocolCompatibility(probe.protocolVersion);
            // "Ahead" is forward-compatible (unknown response fields are just
            // ignored) — only "too old" is a genuine incompatibility.
            payload['compatible'] = compat !== 'server-too-old';
            if (compat === 'server-too-old') {
              warnings.push(
                `This server speaks protocol v${probe.protocolVersion}; this CLI needs at least v${SUPPORTED_PROTOCOL_VERSIONS.min}. Upgrade the server.`,
              );
            } else if (compat === 'server-ahead') {
              warnings.push(
                `This server speaks protocol v${probe.protocolVersion}, ahead of the v${SUPPORTED_PROTOCOL_VERSIONS.max} this CLI build understands. ` +
                  'Most things should still work, but a newer CLI may behave better against it.',
              );
            }
          }
        }
        return { data: payload, ...(warnings.length ? { warnings } : {}) };
      },
    }),

    /**
     * Everything a bug report needs, in one command.
     *
     * The previous CLI made a user run four commands and read four different
     * output shapes to answer "why does the TUI look wrong on my terminal".
     */
    defineCommand({
      id: 'system.doctor',
      group: 'system',
      verb: 'doctor',
      summary: 'Diagnose connection, credential and terminal-capability problems',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: { kind: 'record' },
      async handler(ctx) {
        const checks: Array<{ check: string; result: string; ok: boolean }> = [];

        checks.push({ check: 'cli.version', result: version, ok: true });
        checks.push({
          check: 'terminal',
          result: describeCapabilities(ctx.capabilities),
          ok: true,
        });
        checks.push({
          check: 'config.user',
          result: ctx.config.sources.user ?? 'not found (defaults in use)',
          ok: true,
        });
        checks.push({
          check: 'config.project',
          result: ctx.config.sources.project ?? 'not found',
          ok: true,
        });
        checks.push({
          check: 'connection',
          result: ctx.connection
            ? `${ctx.connection.label} → ${ctx.baseUrl}`
            : 'none configured',
          ok: Boolean(ctx.connection),
        });

        if (ctx.baseUrl) {
          const probe = await probeEndpoint(ctx.baseUrl);
          checks.push({
            check: 'server.reachable',
            result: probe.ok
              ? `${probe.serverName ?? 'ok'} in ${probe.latencyMs}ms`
              : (probe.error ?? 'unreachable'),
            ok: probe.ok,
          });

          if (probe.ok) {
            const compat = checkProtocolCompatibility(probe.protocolVersion);
            checks.push({
              check: 'server.protocol',
              result:
                compat === 'server-too-old'
                  ? `v${probe.protocolVersion} — too old for this CLI (needs v${SUPPORTED_PROTOCOL_VERSIONS.min}+); upgrade the server`
                  : compat === 'server-ahead'
                    ? `v${probe.protocolVersion} — ahead of this CLI build (understands up to v${SUPPORTED_PROTOCOL_VERSIONS.max})`
                    : `v${probe.protocolVersion ?? 'unknown'} — compatible`,
              ok: compat !== 'server-too-old',
            });
          }

          if (probe.ok) {
            try {
              const health = await ctx.api.health();
              checks.push({ check: 'server.health', result: JSON.stringify(health).slice(0, 120), ok: true });
            } catch (error) {
              checks.push({
                check: 'server.health',
                result: error instanceof Error ? error.message : String(error),
                ok: false,
              });
            }
          }
        }

        if (ctx.config.server.apiKey) {
          checks.push({
            check: 'auth.mode',
            result: 'legacy API key (deprecated — run `generatorai device pair`)',
            ok: false,
          });
        }

        return {
          data: checks,
          warnings: checks.filter((c) => !c.ok).map((c) => `${c.check}: ${c.result}`),
        };
      },
    }),
  ];
}
