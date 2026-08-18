// `generatorai system …` — health, models, artifacts, diagnostics.

import { z } from 'zod';
import { defineCommand, type CommandSpec } from '../registry/CommandSpec.js';
import { describeCapabilities } from '../capabilities/TerminalCapabilities.js';
import { probeEndpoint } from '../connection/ConnectionManager.js';
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
        fields: [
          { key: 'status', header: 'Status', format: 'status' },
          { key: 'version', header: 'Version' },
          { key: 'uptime', header: 'Uptime', format: 'duration' },
        ],
      },
      async handler(ctx) {
        const health = await ctx.api.health();
        // `/api/health` reports uptime in seconds; the duration formatter
        // takes milliseconds, so a two-minute-old server read as "120ms".
        return record({ ...health, uptime: health.uptime * 1000 });
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
        if (ctx.connection) {
          const probe = await probeEndpoint(ctx.baseUrl);
          payload['server'] = probe.ok ? (probe.version ?? 'unknown') : `unreachable (${probe.error})`;
          payload['endpoint'] = ctx.baseUrl;
        }
        return record(payload);
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
