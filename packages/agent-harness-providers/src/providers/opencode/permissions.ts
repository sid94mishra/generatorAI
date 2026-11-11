// ────────────────────────────────────────────────────────────────
// OpenCode 2 permissions — the chat's permission mode as session rules, and
// OpenCode's `permission.asked` as the app's PermissionRequest.
//
// OpenCode evaluates `merge(agent.permissions, session.permissions)` and the
// LAST matching rule wins; with no match the answer is `ask`. Every agent
// starts from `* * allow`, so a session created without rules never asks for
// anything. Every session this provider creates therefore carries the full
// ruleset for its mode — on create, resume, fork and every mode change — and
// children (subagent sessions) inherit it at creation.
//
// Two rules hold in every mode:
//   • `execute` is denied. That turns Code Mode off, and OpenCode then lists
//     every tool directly (core `Tool.snapshot`: "Without Code Mode its tools
//     would be unreachable, so expose them as direct tools instead"). Each
//     tool call is then its own call — gated, rendered and recorded on its own
//     — instead of a JavaScript blob that calls tools inside it, and the
//     platform's own tools (client-hosted MCP, always Code Mode otherwise)
//     reach the model as `generatorai_<tool>`.
//   • The platform's tools are allowed: they are the app's own handlers, gated
//     by the app's own policy (as Codex's dynamic tools are).
// ────────────────────────────────────────────────────────────────

import type { HarnessPermissionMode, PermissionRequest } from '@generatorai/core';
import type { Permission_Rule } from '../../protocol/opencode.generated.js';

export type PermissionRule = Permission_Rule;

/** Client-hosted MCP name: the platform's tools reach the model as `generatorai_<tool>`. */
export const HOST_TOOL_NAMESPACE = 'generatorai';

const allow = (action: string, resource = '*'): PermissionRule => ({ action, resource, effect: 'allow' });
const ask = (action: string, resource = '*'): PermissionRule => ({ action, resource, effect: 'ask' });
const deny = (action: string, resource = '*'): PermissionRule => ({ action, resource, effect: 'deny' });

/** Reads OpenCode lets through without asking in every gated mode (the `.env` asks match OpenCode's own defaults). */
const READS: PermissionRule[] = [
  allow('read'),
  allow('glob'),
  allow('grep'),
  ask('read', '*.env'),
  ask('read', '*.env.*'),
  allow('read', '*.env.example'),
];

export interface SessionRuleInput {
  mode: HarnessPermissionMode | undefined;
  /** Roots beyond the working directory the chat may use (other mounts, the managed workspace root). */
  additionalDirectories?: readonly string[];
  /** Skill names the conversation must not use. */
  disabledSkills?: readonly string[];
  /** Explicit skill allow-list: every other skill is denied. */
  skills?: readonly string[];
  /** "Don't ask again" answers given in this conversation (session-scoped, never written to OpenCode's project store). */
  remembered?: readonly PermissionRule[];
}

/** Forward slashes, as OpenCode writes the paths it matches rules against. */
function slash(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * The session ruleset for a permission mode. Order matters: later rules win.
 *
 * | mode              | effect                                                                  |
 * |-------------------|-------------------------------------------------------------------------|
 * | bypassPermissions | everything allowed                                                      |
 * | acceptEdits       | reads and edits allowed; shell, web, subagents, MCP, the rest ask       |
 * | default / plan    | reads allowed; everything else asks (plan: the app's gate refuses writes) |
 * | dontAsk           | reads allowed; everything else denied — nothing ever waits for a human  |
 */
export function sessionRules(input: SessionRuleInput): PermissionRule[] {
  const mode = input.mode ?? 'default';
  const rules: PermissionRule[] = [];
  if (mode === 'bypassPermissions') {
    rules.push(allow('*'));
  } else {
    rules.push(mode === 'dontAsk' ? deny('*') : ask('*'));
    rules.push(...READS);
    // Questions go to the app's question card, not a permission prompt; todos are bookkeeping.
    rules.push(allow('question'), allow('todowrite'), allow('skill'));
    // A subagent's session inherits these rules at creation (core `Session.create`), so its tools ask the same way.
    rules.push(allow('subagent'));
    if (mode === 'acceptEdits') rules.push(allow('edit'));
    // The chat's own other roots are part of its workspace; anything else outside asks (or is denied).
    for (const dir of new Set(input.additionalDirectories ?? [])) {
      const root = slash(dir);
      if (!root) continue;
      rules.push(allow('external_directory', root), allow('external_directory', `${root}/*`));
    }
  }
  if (input.skills) {
    rules.push(deny('skill'));
    for (const name of input.skills) rules.push(allow('skill', name));
  }
  for (const name of input.disabledSkills ?? []) rules.push(deny('skill', name));
  rules.push(...(mode === 'dontAsk' ? [] : input.remembered ?? []));
  rules.push(allow(`${HOST_TOOL_NAMESPACE}_*`));
  // Last, so nothing above can turn Code Mode back on.
  rules.push(deny('execute'));
  return rules;
}

/** What `permission.asked` carries (openapi `permission.asked.data`). */
export interface PermissionAsked {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
  source?: { type: 'tool'; messageID: string; id: string };
  message?: string;
  metadata?: Record<string, unknown>;
}

const FILE_WRITE = new Set(['edit', 'write', 'patch']);
const FILE_READ = new Set(['read', 'glob', 'grep', 'external_directory']);
const NETWORK = new Set(['webfetch', 'websearch']);

/** OpenCode's permission action → the app's permission request kind. */
export function permissionKind(action: string): PermissionRequest['type'] {
  if (FILE_WRITE.has(action)) return 'file_write';
  if (FILE_READ.has(action)) return 'file_read';
  if (action === 'shell') return 'shell_exec';
  if (NETWORK.has(action)) return 'network';
  return 'other';
}

/** `permission.asked` as the request the chat's approval card shows. */
export function toPermissionRequest(asked: PermissionAsked): PermissionRequest {
  const resources = asked.resources.filter((r) => r && r !== '*');
  const description =
    asked.message?.trim() ||
    (asked.action === 'shell' && resources.length
      ? `Run: ${resources.join(' && ')}`
      : `${asked.action}${resources.length ? `: ${resources.join(', ')}` : ''}`);
  return {
    type: permissionKind(asked.action),
    description,
    details: {
      action: asked.action,
      resources: asked.resources,
      ...(asked.action === 'shell' && resources.length ? { command: resources.join(' && ') } : {}),
      ...(FILE_WRITE.has(asked.action) || FILE_READ.has(asked.action) ? { paths: resources } : {}),
      ...(asked.metadata ? { metadata: asked.metadata } : {}),
      ...(asked.source ? { toolCallId: `${asked.source.messageID}:${asked.source.id}` } : {}),
      provider: 'opencode',
    },
  };
}

/**
 * The session rules a "don't ask again" adds: allow this action for what was asked (OpenCode's own `save` patterns
 * when the tool proposed them, which generalise a command to its prefix). Kept on the session, never answered as
 * OpenCode's `always` — that would save a project-wide approval into the user's own OpenCode as well.
 */
export function rememberRules(asked: PermissionAsked): PermissionRule[] {
  const patterns = asked.save?.length ? asked.save : asked.resources;
  return [...new Set(patterns)].map((resource) => allow(asked.action, resource));
}
