// ────────────────────────────────────────────────────────────────
// Administration views — the twelve surfaces Phase 8 item 5 asks for,
// declared as data over the command registry rather than hand-built.
//
// The audit asks for "complete extension, agent, skill, prompt, MCP, hook,
// webhook, provider, connection, device, security, and diagnostics panes".
// Built one at a time that is twelve components, twelve column lists and
// twelve chances to drift from the command each one is showing. Declared
// here, each view is a command id plus optional preset arguments, and the
// pane renders it with that command's OWN `output.columns` — so a view can
// never advertise a column the command does not return, and adding a column
// to a command adds it to the view.
//
// Nothing here fetches or renders; `resolveAdminView` is a lookup and
// `adminViewColumns` reads the spec. Both are pure, so the whole table can be
// checked against the real registry in a test — which is what catches a view
// naming a command that does not exist, the failure mode a hand-built pane
// hides until someone opens it.
// ────────────────────────────────────────────────────────────────

import type { ColumnSpec, CommandSpec } from './CommandSpec.js';
import type { CommandRegistry } from './registry.js';

export interface AdminView {
  /** Stable id, used as the pane's `entityId` and in the view picker. */
  id: string;
  title: string;
  /** One-line description, shown in the picker. */
  description: string;
  /** The command whose rows this view shows. */
  command: string;
  /** Positional arguments the view supplies itself. */
  args?: Record<string, string>;
  /** Flags the view supplies itself. */
  flags?: Record<string, string | number | boolean>;
  /**
   * Set when the command needs a value the view cannot know (a session id, a
   * chat) — the pane prompts for it instead of failing validation with a
   * schema error the user did not cause.
   *
   * `target` says which half of `{args, flags}` the answer belongs in: some
   * commands take the scoping value positionally (`hook list <session>`),
   * others as a flag (`widget list --chat`).
   */
  prompt?: { target?: 'arg' | 'flag'; arg: string; message: string };
  /** Command run by `n` in this view, if creating one makes sense. */
  createCommand?: string;
  /** Command run by `d`, with the argument the selected row's `id` fills. */
  removeCommand?: { id: string; arg: string };
  /** `record`-shaped commands render as a key/value inspector, not a table. */
  shape?: 'list' | 'record';
}

/**
 * Grouped the way the audit's own sentence groups them, so the picker reads
 * as an answer to it rather than as an arbitrary ordering.
 */
export const ADMIN_VIEWS: AdminView[] = [
  // ── Extensions and artifacts ──
  {
    id: 'extensions',
    title: 'Extensions',
    description: 'Installed extensions and their scope',
    command: 'extension.list',
    removeCommand: { id: 'extension.uninstall', arg: 'extension' },
  },
  {
    id: 'widgets',
    title: 'Widgets',
    description: 'Extension widgets in one chat, degraded to text',
    command: 'widget.list',
    // Widgets are scoped: `GET /api/widgets` returns an empty list unless a
    // chat, run or session is named, so a view that did not ask would show
    // "no widgets" for every server, always.
    prompt: { target: 'flag', arg: 'chat', message: 'Widgets in which chat id?' },
  },
  {
    id: 'agents',
    title: 'Agents',
    description: 'Agent definitions across every scope',
    command: 'agent.list',
    removeCommand: { id: 'agent.delete', arg: 'agent' },
  },
  {
    id: 'skills',
    title: 'Skills',
    description: 'System-scope skill artifacts',
    command: 'system.artifacts',
    flags: { type: 'skill' },
  },
  {
    id: 'prompts',
    title: 'Prompts',
    description: 'System-scope prompt artifacts',
    command: 'system.artifacts',
    flags: { type: 'prompt' },
  },
  {
    id: 'templates',
    title: 'Templates',
    description: 'Workflow templates the server ships',
    command: 'template.list',
  },

  // ── Integration surfaces ──
  {
    id: 'mcp',
    title: 'MCP servers',
    description: 'System-scope Model Context Protocol servers',
    command: 'system.mcpServers',
  },
  {
    id: 'hook-phases',
    title: 'Hook phases',
    description: 'Every phase the server can invoke a hook on',
    command: 'hook.phases',
  },
  {
    id: 'hooks',
    title: 'Hooks (by session)',
    description: 'Global hooks plus per-workflow overrides for one session',
    command: 'hook.list',
    // `hook list` is session-scoped and there is no "all hooks" route — a
    // view that silently substituted some session would be showing the wrong
    // answer confidently, so it asks.
    prompt: { arg: 'session', message: 'Which session id?' },
  },
  {
    id: 'webhooks',
    title: 'Webhooks',
    description: 'Registered outbound webhooks',
    command: 'webhook.list',
    createCommand: 'webhook.create',
    removeCommand: { id: 'webhook.delete', arg: 'webhook' },
  },
  {
    id: 'providers',
    title: 'Providers & models',
    description: 'Models each configured harness provider offers',
    command: 'system.models',
  },

  // ── Connectivity and identity ──
  {
    id: 'connections',
    title: 'Connections',
    description: 'Servers this CLI knows about',
    command: 'connect.list',
    createCommand: 'connect.add',
    removeCommand: { id: 'connect.remove', arg: 'connection' },
  },
  {
    id: 'devices',
    title: 'Devices',
    description: 'Devices paired with this server',
    command: 'device.list',
    removeCommand: { id: 'device.revoke', arg: 'device' },
  },
  {
    id: 'device-invites',
    title: 'Device invites',
    description: 'Outstanding pairing invitations',
    command: 'device.invites',
    createCommand: 'device.invite',
  },
  {
    id: 'device-audit',
    title: 'Device audit',
    description: 'What each device has done',
    command: 'device.audit',
  },

  // ── Security ──
  {
    id: 'security-posture',
    title: 'Security posture',
    description: 'Sandbox, network and permission posture',
    command: 'security.posture',
    shape: 'record',
  },
  {
    id: 'security-network',
    title: 'Network access',
    description: 'What the agent is allowed to reach',
    command: 'security.networkAccess',
    shape: 'record',
  },
  {
    id: 'security-audit',
    title: 'Security audit',
    description: 'Security-relevant events',
    command: 'security.audit',
  },

  // ── Diagnostics ──
  {
    id: 'doctor',
    title: 'Diagnostics',
    description: 'Environment, connectivity and protocol checks',
    command: 'system.doctor',
    shape: 'record',
  },
  {
    id: 'health',
    title: 'Server health',
    description: 'The server\'s own health report',
    command: 'system.health',
    shape: 'record',
  },
  {
    id: 'version',
    title: 'Versions',
    description: 'CLI and server versions, and whether they are compatible',
    command: 'system.version',
    shape: 'record',
  },
  {
    id: 'server-config',
    title: 'Server configuration',
    description: 'Effective server-side configuration',
    command: 'system.config',
    shape: 'record',
  },
];

export function resolveAdminView(id: string): AdminView | undefined {
  return ADMIN_VIEWS.find((view) => view.id === id);
}

/**
 * The columns a view's table should use — the command's own, so the two
 * cannot disagree.
 *
 * Falls back to a bare id column for a command whose output spec declares
 * none, which is what `ListPane` already does for an unknown data key: a
 * table with no columns renders nothing at all, which reads as "no data"
 * rather than "no column spec".
 */
export function adminViewColumns(spec: CommandSpec | undefined): ColumnSpec[] {
  const columns = spec?.output.columns ?? spec?.output.fields;
  if (columns?.length) return columns;
  return [{ key: 'id', header: 'ID', format: 'id', priority: 0 }];
}

/** Views whose command is missing from a registry — the drift a table like this exists to make findable. */
export function unresolvableAdminViews(registry: CommandRegistry): string[] {
  const missing: string[] = [];
  for (const view of ADMIN_VIEWS) {
    if (!registry.get(view.command)) missing.push(`${view.id} → ${view.command}`);
    if (view.createCommand && !registry.get(view.createCommand)) {
      missing.push(`${view.id} → ${view.createCommand}`);
    }
    if (view.removeCommand && !registry.get(view.removeCommand.id)) {
      missing.push(`${view.id} → ${view.removeCommand.id}`);
    }
  }
  return missing;
}
