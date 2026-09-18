// ────────────────────────────────────────────────────────────────
// agentModel — pure presentation logic for the agent detail sheet.
//
// No React Native imports: everything here is unit-tested under vitest in a
// node environment (src/__tests__/agentModel.test.ts). The sheet only binds
// these helpers to queries and primitives.
// ────────────────────────────────────────────────────────────────

/** Mirrors `Tone` in ui/primitives (kept local so this file stays RN-free). */
export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export type AgentScopeValue = 'system' | 'global' | 'project';
export type AgentRoleValue = 'agent' | 'orchestrator';

/** The subset of the full `Agent` (GET /api/agents/:id) the sheet reads. */
export interface AgentDetailLike {
  instructions?: string | null;
  runtime?: {
    model?: string | null;
    harnessType?: string | null;
    reasoningEffort?: string | null;
    permissionMode?: string | null;
  } | null;
  orchestration?: { teamAgentRefs?: string[] | null; maxWorkers?: number | null } | null;
}

/** Muted scope label shown under the name. */
export function scopeLabel(scope: string): string {
  switch (scope) {
    case 'system':
      return 'Built-in';
    case 'global':
      return 'Global';
    case 'project':
      return 'Project';
    default:
      return humanizeId(scope);
  }
}

export interface AgentBadge {
  label: string;
  tone: BadgeTone;
}

/**
 * Badges only for NON-default state. A regular, enabled, non-project agent
 * gets none — the scope label already says where it lives.
 *
 * Tones stay neutral/warning on purpose: colour means status in this app, and
 * "orchestrator" or "project" are not statuses.
 */
export function agentBadges(agent: { role: string; enabled: boolean; scope: string }): AgentBadge[] {
  const out: AgentBadge[] = [];
  if (!agent.enabled) out.push({ label: 'Disabled', tone: 'warning' });
  if (agent.role === 'orchestrator') out.push({ label: 'Orchestrator', tone: 'neutral' });
  if (agent.scope === 'project') out.push({ label: 'Project', tone: 'neutral' });
  return out;
}

/**
 * Whether a chat can be started with this agent from the phone.
 *
 * The server binds any enabled agent on create — an orchestrator-role agent
 * switches the chat into orchestrate mode itself — so only `enabled` and the
 * `write:chats` scope matter.
 */
export function startChatAvailability(
  agent: { enabled: boolean },
  scopes: readonly string[],
): { allowed: boolean; reason: string | null } {
  if (!agent.enabled) return { allowed: false, reason: 'This agent is turned off.' };
  if (!scopes.includes('write:chats')) {
    return { allowed: false, reason: 'This device is not allowed to start chats.' };
  }
  return { allowed: true, reason: null };
}

/** Body for `POST /api/chats` that binds the agent. */
export function startChatBody(agent: {
  name: string;
  ref: string;
  scope: string;
  projectId?: string | null;
}): { name: string; agentRef: string; projectId?: string } {
  return {
    name: agent.name.trim() || 'New chat',
    agentRef: agent.ref,
    ...(agent.scope === 'project' && agent.projectId ? { projectId: agent.projectId } : {}),
  };
}

const HARNESS_LABELS: Record<string, string> = {
  copilot: 'GitHub Copilot',
  'claude-agent': 'Claude Code',
};

const EFFORT_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

const PERMISSION_LABELS: Record<string, string> = {
  default: 'Ask me',
  acceptEdits: 'Auto-accept edits',
  bypassPermissions: 'Full autonomy',
  plan: 'Plan first',
  dontAsk: 'Never ask',
};

export interface RuntimeRow {
  key: 'model' | 'provider' | 'effort' | 'permission';
  title: string;
  value: string;
}

/**
 * Runtime rows, only for fields that carry a value. The model row always
 * appears — "Inherits" is itself useful information — the rest are omitted
 * when unset rather than padded with dashes.
 */
export function runtimeRows(
  runtime: AgentDetailLike['runtime'],
  modelName?: (id: string) => string | undefined,
): RuntimeRow[] {
  const rt = runtime ?? {};
  const rows: RuntimeRow[] = [];
  const model = clean(rt.model);
  rows.push({
    key: 'model',
    title: 'Model',
    value: model ? (modelName?.(model) ?? model) : 'Inherits',
  });
  const harness = clean(rt.harnessType);
  if (harness) rows.push({ key: 'provider', title: 'Provider', value: HARNESS_LABELS[harness] ?? humanizeId(harness) });
  const effort = clean(rt.reasoningEffort);
  if (effort) rows.push({ key: 'effort', title: 'Reasoning effort', value: EFFORT_LABELS[effort] ?? humanizeId(effort) });
  const permission = clean(rt.permissionMode);
  if (permission) {
    rows.push({ key: 'permission', title: 'Approvals', value: PERMISSION_LABELS[permission] ?? humanizeId(permission) });
  }
  return rows;
}

export interface InstructionPreview {
  text: string;
  truncated: boolean;
}

/**
 * First `maxLines` lines (and at most `maxChars` characters) of the
 * instructions. Leading/trailing blank lines are dropped and runs of blank
 * lines collapse, so the preview is not half whitespace.
 */
export function instructionPreview(
  instructions: string | null | undefined,
  maxLines = 6,
  maxChars = 480,
): InstructionPreview {
  const normalized = (instructions ?? '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return { text: '', truncated: false };
  const lines = normalized.split('\n');
  let text = lines.slice(0, maxLines).join('\n');
  let truncated = lines.length > maxLines;
  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars);
    const lastSpace = cut.lastIndexOf(' ');
    text = (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
    truncated = true;
  }
  return { text: truncated ? `${text.trimEnd()}…` : text, truncated };
}

/**
 * Turn a slug-like id into something readable:
 * `code-review` → "Code review", `mcp/github_server` → "Github server",
 * `project:my-helper` → "My helper". Opaque UUIDs are shortened rather than
 * "humanised" into nonsense.
 */
export function humanizeId(id: string): string {
  const raw = id.trim();
  if (!raw) return '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return raw.slice(0, 8);
  }
  // Keep the last path / namespace segment: that is the part a person named.
  const segment = raw.split(/[/:]/).filter(Boolean).pop() ?? raw;
  const words = segment
    .replace(/\.(md|json|ya?ml)$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_.\s]+/g, ' ')
    .trim()
    .toLowerCase();
  if (!words) return raw;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface CatalogName {
  id?: string | null;
  name?: string | null;
}

/**
 * Resolve ids against one or more catalogues (first match wins, so pass the
 * most specific — project — first). Unknown ids fall back to `humanizeId`
 * and are flagged so the row can say it was not found.
 */
export function resolveNames(
  ids: readonly string[],
  ...catalogs: ReadonlyArray<readonly CatalogName[] | undefined>
): Array<{ id: string; name: string; known: boolean }> {
  const lookup = new Map<string, string>();
  for (const catalog of catalogs) {
    for (const entry of catalog ?? []) {
      const key = clean(entry?.id) ?? clean(entry?.name);
      const name = clean(entry?.name);
      if (key && name && !lookup.has(key)) lookup.set(key, name);
    }
  }
  return ids.map((id) => {
    const name = lookup.get(id);
    return name ? { id, name, known: true } : { id, name: humanizeId(id), known: false };
  });
}

/**
 * Display names for an orchestrator's team, from its policy refs. An empty
 * list means "any enabled agent", which is returned as `null` so the sheet
 * can say so instead of rendering an empty section.
 */
export function delegateTargets(
  orchestration: AgentDetailLike['orchestration'],
  known: ReadonlyArray<{ ref: string; name: string }>,
): Array<{ ref: string; name: string }> | null {
  const refs = orchestration?.teamAgentRefs ?? [];
  if (refs.length === 0) return null;
  const byRef = new Map(known.map((a) => [a.ref, a.name]));
  return refs.map((ref) => ({ ref, name: byRef.get(ref) ?? humanizeId(ref) }));
}

export interface UsageSummary {
  total: number;
  groups: Array<{ key: 'chats' | 'workflows' | 'stages'; title: string; items: Array<{ id: string; name: string }> }>;
}

/**
 * Defensive read of `GET /api/agents/:id/usage`
 * (`{ chats: [{id,name}], stages: [{id,name,workflowDefinitionId}], workflows: [{id,name}] }`).
 * Anything malformed is treated as empty rather than thrown.
 */
export function summarizeUsage(raw: unknown): UsageSummary {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pick = (key: string): Array<{ id: string; name: string }> => {
    const value = obj[key];
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const rec = item as Record<string, unknown>;
      const id = typeof rec['id'] === 'string' ? rec['id'] : null;
      if (!id) return [];
      const name = typeof rec['name'] === 'string' && rec['name'].trim() ? rec['name'].trim() : 'Untitled';
      return [{ id, name }];
    });
  };
  const groups: UsageSummary['groups'] = [
    { key: 'workflows' as const, title: 'Workflows', items: pick('workflows') },
    { key: 'stages' as const, title: 'Workflow stages', items: pick('stages') },
    { key: 'chats' as const, title: 'Chats', items: pick('chats') },
  ].filter((g) => g.items.length > 0);
  return { total: groups.reduce((n, g) => n + g.items.length, 0), groups };
}

function clean(value: string | null | undefined): string | null {
  const v = typeof value === 'string' ? value.trim() : '';
  return v ? v : null;
}

// ── Lightweight editing (admin:settings) ─────────────────────────

export const AGENT_EDIT_SCOPE = 'admin:settings';

/**
 * Whether the sheet offers Edit. Built-in agents are synced from bundled
 * files on every start, so an edit would silently revert; they stay
 * read-only regardless of scope.
 */
export function agentEditAvailability(
  agent: { scope: string },
  scopes: readonly string[],
): { editable: boolean; reason: string | null; requestable: boolean } {
  if (agent.scope === 'system') {
    return { editable: false, reason: 'Built-in agents cannot be changed.', requestable: false };
  }
  if (!scopes.includes(AGENT_EDIT_SCOPE)) {
    return {
      editable: false,
      reason: 'Editing agents needs settings-admin permission on this device.',
      requestable: true,
    };
  }
  return { editable: true, reason: null, requestable: false };
}

export interface AgentDraft {
  name: string;
  description: string;
  instructions: string;
  /** Empty string = inherit the default model. */
  model: string;
}

export function agentDraftFrom(agent: {
  name: string;
  description?: string | null;
  instructions?: string | null;
  runtime?: { model?: string | null } | null;
}): AgentDraft {
  return {
    name: agent.name,
    description: agent.description ?? '',
    instructions: agent.instructions ?? '',
    model: agent.runtime?.model ?? '',
  };
}

/** Field → message, mirroring `CreateAgentSchema` so the server never 400s on these. */
export function validateAgentDraft(draft: AgentDraft): Partial<Record<keyof AgentDraft, string>> {
  const errors: Partial<Record<keyof AgentDraft, string>> = {};
  const name = draft.name.trim();
  if (!name) errors.name = 'Give the agent a name.';
  else if (name.length > 120) errors.name = 'Keep the name under 120 characters.';
  const description = draft.description.trim();
  if (description.length < 10) {
    errors.description = 'At least 10 characters — the model uses this to decide when to pick the agent.';
  } else if (description.length > 2000) errors.description = 'Keep the description under 2000 characters.';
  if (!draft.instructions.trim()) errors.instructions = 'Instructions cannot be empty.';
  if (draft.model.length > 200) errors.model = 'That model id is too long.';
  return errors;
}

/**
 * `PUT /api/agents/:id` body with only the changed fields, or null.
 *
 * `runtime` is replaced wholesale by the server's merge (`{...existing,
 * ...params}`), so a model change sends the FULL existing runtime with the
 * model swapped — sending `{ model }` alone would wipe effort, provider and
 * permission mode.
 */
export function agentUpdateBody(
  saved: AgentDetailLike & { name: string; description?: string | null },
  draft: AgentDraft,
): Record<string, unknown> | null {
  const before = agentDraftFrom(saved);
  const body: Record<string, unknown> = {};
  if (draft.name.trim() !== before.name.trim()) body['name'] = draft.name.trim();
  if (draft.description.trim() !== before.description.trim()) body['description'] = draft.description.trim();
  if (draft.instructions !== before.instructions && draft.instructions.trim() !== before.instructions.trim()) {
    body['instructions'] = draft.instructions;
  }
  const model = draft.model.trim();
  if (model !== (before.model ?? '').trim()) {
    const runtime: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(saved.runtime ?? {})) {
      if (value !== null && value !== undefined && key !== 'model') runtime[key] = value;
    }
    if (model) runtime['model'] = model;
    body['runtime'] = runtime;
  }
  return Object.keys(body).length > 0 ? body : null;
}
