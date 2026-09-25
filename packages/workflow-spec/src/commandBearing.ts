// ────────────────────────────────────────────────────────────────
// Command-bearing (privileged) fields: every place a workflow can make the
// server run a program, spend a stored provider key at an endpoint of its
// choosing (`session.provider`, P02 review R1) or run without approvals
// (`session.permissionMode: bypassPermissions`, R5). Adding or changing one
// needs an elevated scope
// (`admin:settings`); the server decides by comparing fingerprints of the
// old and the new graph (P01 WP-1.7, W-34). The security layer of the
// validator walks the same registry, so a new command-bearing field is
// covered by both once it is registered here. P05 registers the `check`
// stage kind.
// ────────────────────────────────────────────────────────────────

import type { WorkflowGraph } from './schemas/graph.js';
import type { McpServerConfig, SessionSpec } from './schemas/session.js';
import type { PreprocessingStep } from './schemas/workflow.js';
import { canonicalJson } from './expr/values.js';
import { pointerToken } from './validate/issues.js';

export type CommandFieldKind =
  | 'hook'
  | 'compensation'
  | 'action'
  | 'rule'
  | 'preprocessing'
  | 'postprocessing'
  | 'mcp'
  | 'provider'
  | 'bypass';

export interface CommandField {
  kind: CommandFieldKind;
  /** JSON pointer (stages by index) into the graph. */
  pointer: string;
  /** Position-independent id (stages by key), for fingerprints. */
  stableId: string;
  stageKey?: string;
  /** The executable, or the shell script text for script steps. */
  command?: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  /** The whole command-bearing object, for the fingerprint. */
  value: unknown;
}

export type CommandCollector = (graph: WorkflowGraph, out: CommandField[]) => void;

type HookLike = { config: { type: string } & Record<string, unknown> };

function hookFields(
  list: readonly HookLike[] | undefined,
  kind: CommandFieldKind,
  pointer: string,
  stableId: string,
  out: CommandField[],
  stageKey?: string,
): void {
  list?.forEach((h, i) => {
    const c = h.config;
    const base = { kind, pointer: `${pointer}/${i}/config`, stableId: `${stableId}/${i}`, ...(stageKey ? { stageKey } : {}) };
    if (c.type === 'script') {
      out.push({
        ...base,
        command: c['command'] as string,
        args: (c['args'] as string[] | undefined) ?? [],
        ...(c['env'] ? { env: c['env'] as Record<string, string> } : {}),
        value: c,
      });
    } else if (c.type === 'function') {
      out.push({ ...base, value: c });
    }
  });
}

function mcpFields(session: SessionSpec | undefined, pointer: string, stableId: string, out: CommandField[], stageKey?: string): void {
  const servers = session?.mcp?.servers;
  if (!servers) return;
  for (const [id, cfg] of Object.entries(servers) as Array<[string, McpServerConfig]>) {
    if (cfg.type !== 'stdio') continue;
    out.push({
      kind: 'mcp',
      pointer: `${pointer}/mcp/servers/${pointerToken(id)}`,
      stableId: `${stableId}/mcp/${id}`,
      ...(stageKey ? { stageKey } : {}),
      ...(cfg.command !== undefined ? { command: cfg.command } : {}),
      args: cfg.args ?? [],
      ...(cfg.env ? { env: cfg.env } : {}),
      value: cfg,
    });
  }
}

/**
 * A session's privileged non-command fields: a BYOK provider (its key is a
 * stored secret sent to `baseUrl`) and a bypass permission mode.
 */
function sessionPrivilegeFields(
  session: SessionSpec | undefined,
  pointer: string,
  stableId: string,
  out: CommandField[],
  stageKey?: string,
): void {
  const key = stageKey ? { stageKey } : {};
  if (session?.provider) {
    out.push({ kind: 'provider', pointer: `${pointer}/provider`, stableId: `${stableId}/provider`, ...key, value: session.provider });
  }
  if (session?.permissionMode === 'bypassPermissions') {
    out.push({ kind: 'bypass', pointer: `${pointer}/permissionMode`, stableId: `${stableId}/bypass`, ...key, value: 'bypassPermissions' });
  }
}

function preprocessingFields(steps: readonly PreprocessingStep[], pointer: string, stableId: string, out: CommandField[]): void {
  steps.forEach((s, i) => {
    const p = `${pointer}/${i}/config`;
    if (s.config.type === 'run_script') {
      out.push({ kind: 'preprocessing', pointer: p, stableId: `${stableId}/${i}`, command: s.config.script, value: s.config });
    } else if (s.config.type === 'conditional') {
      preprocessingFields(s.config.thenSteps, `${p}/thenSteps`, `${stableId}/${i}/then`, out);
      preprocessingFields(s.config.elseSteps ?? [], `${p}/elseSteps`, `${stableId}/${i}/else`, out);
    }
  });
}

/** The registry. Each collector appends the fields of one area of the graph. */
export const COMMAND_COLLECTORS: CommandCollector[] = [
  (g, out) => hookFields(g.workflow.hooks, 'hook', '/workflow/hooks', 'workflow/hooks', out),
  (g, out) => hookFields(g.workflow.onExit, 'action', '/workflow/onExit', 'workflow/onExit', out),
  (g, out) => hookFields(g.workflow.onFailure, 'action', '/workflow/onFailure', 'workflow/onFailure', out),
  (g, out) => mcpFields(g.workflow.session, '/workflow/session', 'workflow/session', out),
  (g, out) => sessionPrivilegeFields(g.workflow.session, '/workflow/session', 'workflow/session', out),
  (g, out) =>
    preprocessingFields(g.workflow.lifecycle.preprocessingSteps, '/workflow/lifecycle/preprocessingSteps', 'workflow/pre', out),
  (g, out) =>
    g.workflow.lifecycle.postProcessing.steps.forEach((s, i) => {
      if (s.config.type === 'run_script') {
        out.push({
          kind: 'postprocessing',
          pointer: `/workflow/lifecycle/postProcessing/steps/${i}/config`,
          stableId: `workflow/post/${i}`,
          command: s.config.script,
          value: s.config,
        });
      }
    }),
  (g, out) =>
    g.stages.forEach((s, i) => {
      const p = `/stages/${i}`;
      const id = `stages/${s.key}`;
      hookFields(s.hooks, 'hook', `${p}/hooks`, `${id}/hooks`, out, s.key);
      // restore_checkpoint entries are skipped by hookFields (neither script nor function).
      hookFields(s.compensate as HookLike[] | undefined, 'compensation', `${p}/compensate`, `${id}/compensate`, out, s.key);
      mcpFields(s.session, `${p}/session`, `${id}/session`, out, s.key);
      sessionPrivilegeFields(s.session, `${p}/session`, `${id}/session`, out, s.key);
      s.output.rules.forEach((r, j) => {
        if (r.type !== 'custom_script') return;
        out.push({
          kind: 'rule',
          pointer: `${p}/output/rules/${j}`,
          stableId: `${id}/rules/${j}`,
          stageKey: s.key,
          command: r.command,
          args: r.args,
          ...(r.env ? { env: r.env } : {}),
          value: { command: r.command, args: r.args, env: r.env ?? null },
        });
      });
    }),
];

export function collectCommandFields(graph: WorkflowGraph): CommandField[] {
  const out: CommandField[] = [];
  for (const c of COMMAND_COLLECTORS) c(graph, out);
  return out;
}

/**
 * Canonical text of every command-bearing field, keyed by stable id. Two
 * graphs with the same fingerprint run the same commands; a save that
 * changes it needs `admin:settings`. The server hashes this text.
 */
export function commandFingerprint(graph: WorkflowGraph): string {
  const entries = collectCommandFields(graph)
    .map((f) => [f.stableId, f.value] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return canonicalJson(entries);
}
