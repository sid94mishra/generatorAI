// The stage editor's pure parts (M8-06; MStagePrompt … MStageHooks; MD-04 simple fields): the tab counts, the
// template references a prompt reads (undeclared variables, the insertable references), durations as "10m", the
// retry groups and the retry sentence, the effective platform tools over the bound agent, rule summaries, and
// renaming a stage key through the graph. Unit-tested.
import { templateVariableNames, type AgentStage, type ResultValidationRule, type StageErrorCode, type StageSpec, type WorkflowGraph } from '@generatorai/workflow-spec';

export const STAGE_TABS = ['prompt', 'session', 'tools', 'output', 'policy', 'hooks'] as const;
export type StageTab = (typeof STAGE_TABS)[number];

export function parseStageTab(raw: unknown): StageTab {
  return (STAGE_TABS as readonly unknown[]).includes(raw) ? (raw as StageTab) : 'prompt';
}

// ── Durations ("30s", "10m", "1h 30m") ──────────────────────────────

const UNIT: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** "10m" → 600000; a bare number is seconds; "" → undefined; nonsense → null. */
export function parseDuration(text: string): number | undefined | null {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 1000);
  let total = 0;
  let rest = t.replace(/\s+/g, '');
  while (rest) {
    const m = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)/.exec(rest);
    if (!m) return null;
    total += Number(m[1]) * UNIT[m[2]!]!;
    rest = rest.slice(m[0].length);
  }
  return Math.round(total);
}

/** 600000 → "10m"; 90000 → "1m 30s"; undefined → "". */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${ms}ms`;
  const parts: string[] = [];
  let rest = Math.round(ms / 1000);
  for (const [u, s] of [['d', 86_400], ['h', 3600], ['m', 60], ['s', 1]] as const) {
    if (rest >= s) {
      parts.push(`${Math.floor(rest / s)}${u}`);
      rest %= s;
    }
  }
  return parts.join(' ');
}

// ── Prompts ─────────────────────────────────────────────────────────

const SYSTEM_NAME = /^(__|repo_path_|repo_branch_)/;

/** Variables the prompts read that the workflow does not declare (system names excluded). */
export function undeclaredVariables(texts: readonly string[], declared: readonly string[]): string[] {
  const known = new Set(declared);
  const out = new Set<string>();
  for (const t of texts) for (const n of templateVariableNames(t)) if (!known.has(n) && !SYSTEM_NAME.test(n)) out.add(n);
  return [...out];
}

/** How many `{{ … }}` references a text has. */
export function refCount(text: string): number {
  return (text.match(/\{\{/g) ?? []).length;
}

export interface InsertableRef {
  group: 'Variables' | 'Earlier stages' | 'Run';
  ref: string;
  type: string;
}

/** What "Insert variable" offers: declared variables (bare names), the stages before this one, the run's codebases. */
export function insertableRefs(graph: WorkflowGraph, stageKey: string, order: readonly string[]): InsertableRef[] {
  const vars = graph.workflow.variables.map((v) => ({ group: 'Variables' as const, ref: v.name, type: v.type }));
  const at = order.indexOf(stageKey);
  const earlier = (at < 0 ? [] : order.slice(0, at)).map((k) => {
    const s = graph.stages.find((x) => x.key === k);
    const json = s?.kind === 'agent' && s.output.format === 'json';
    return { group: 'Earlier stages' as const, ref: `stages.${k}.output`, type: json ? 'JSON' : 'Text' };
  });
  const run = [
    ...graph.workflow.lifecycle.codebaseAliases.map((a) => ({ group: 'Run' as const, ref: `run.codebases.${a}.path`, type: 'String' })),
    { group: 'Run' as const, ref: 'run.id', type: 'String' },
  ];
  return [...vars, ...earlier, ...run];
}

/** Insert `{{ ref }}` at the selection (the end when unknown). */
export function insertRef(text: string, ref: string, at?: { start: number; end: number }): string {
  const token = `{{ ${ref} }}`;
  if (!at) return `${text}${text && !/\s$/.test(text) ? ' ' : ''}${token}`;
  return `${text.slice(0, at.start)}${token}${text.slice(at.end)}`;
}

// ── Output rules ────────────────────────────────────────────────────

export const RULE_LABEL: Record<ResultValidationRule['type'], string> = {
  contains: 'Contains',
  not_contains: 'Not contains',
  min_length: 'Min length',
  max_length: 'Max length',
  regex: 'Regex',
  json_schema: 'JSON Schema',
  custom_script: 'Custom script',
  judge: 'Judge',
};

/** Rules the phone edits (simple fields); the rest show "Edit on desktop" (MD-04). */
export const SIMPLE_RULES = ['contains', 'not_contains', 'min_length', 'max_length', 'regex'] as const;
export type SimpleRuleType = (typeof SIMPLE_RULES)[number];

export function newRule(type: SimpleRuleType): ResultValidationRule {
  if (type === 'min_length' || type === 'max_length') return { type, value: type === 'min_length' ? 1 : 10_000 };
  if (type === 'regex') return { type, pattern: '.+' };
  return { type, value: 'TODO' };
}

export function ruleDetail(rule: ResultValidationRule): string {
  switch (rule.type) {
    case 'contains':
    case 'not_contains':
      return `"${rule.value}"`;
    case 'min_length':
    case 'max_length':
      return `${rule.value} characters`;
    case 'regex':
      return rule.pattern;
    case 'json_schema':
      return `Output matches the schema · ${schemaFieldCount(rule.schema)} fields`;
    case 'custom_script':
      return [rule.command, ...rule.args].join(' ');
    case 'judge':
      return `Pass mark ${rule.threshold}/10`;
  }
}

/** The top-level properties of a JSON schema ("5 fields"). */
export function schemaFieldCount(schema: Record<string, unknown> | undefined): number {
  const props = schema?.properties;
  return props && typeof props === 'object' ? Object.keys(props).length : 0;
}

/** The regex the server accepts (no backreferences, no lookaround); null when fine. */
export function regexProblem(pattern: string): string | null {
  if (/\\[1-9]|\(\?[=!<]/.test(pattern)) return 'Backreferences and lookaround are not supported';
  try {
    new RegExp(pattern);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid pattern';
  }
}

// ── Retry ───────────────────────────────────────────────────────────

/** The board's four groups over the transient error codes; every group on = `retryOn` omitted. */
export const RETRY_GROUPS: { id: string; label: string; codes: StageErrorCode[] }[] = [
  { id: 'transient', label: 'Connection', codes: ['transport'] },
  { id: 'rate', label: 'Rate limit', codes: ['rate_limited', 'overloaded'] },
  { id: 'timeout', label: 'Timeout', codes: ['idle_timeout', 'attempt_timeout'] },
  { id: 'provider', label: 'Provider error', codes: ['provider_5xx', 'provider_crashed'] },
];

export function retryGroupsOn(retryOn: readonly StageErrorCode[] | undefined): string[] {
  if (!retryOn) return RETRY_GROUPS.map((g) => g.id);
  return RETRY_GROUPS.filter((g) => g.codes.some((c) => retryOn.includes(c))).map((g) => g.id);
}

/** The groups chosen → `retryOn` (other codes already listed are kept; all groups and nothing else → omitted). */
export function retryOnFor(groups: readonly string[], previous: readonly StageErrorCode[] | undefined): StageErrorCode[] | undefined {
  const grouped = new Set(RETRY_GROUPS.flatMap((g) => g.codes));
  const others = (previous ?? []).filter((c) => !grouped.has(c));
  if (groups.length === RETRY_GROUPS.length && !others.length) return undefined;
  return [...others, ...RETRY_GROUPS.filter((g) => groups.includes(g.id)).flatMap((g) => g.codes)];
}

/** "Waits 1s, 2s, then gives up after 3 attempts." */
export function retrySentence(retry: NonNullable<AgentStage['retry']>, onExhausted: 'pause' | 'fail' = 'pause'): string {
  const waits: string[] = [];
  let d = retry.initialDelayMs;
  for (let i = 1; i < retry.maxAttempts && waits.length < 4; i++) {
    waits.push(formatDuration(Math.min(d, retry.maxDelayMs)) || '0s');
    d *= retry.backoffMultiplier;
  }
  const end = onExhausted === 'pause' ? 'then pauses for a person' : 'then fails';
  if (!waits.length) return `One attempt, ${end}.`;
  return `Waits ${waits.join(', ')}${retry.maxAttempts - 1 > waits.length ? ', …' : ''}, ${end} after ${retry.maxAttempts} attempts.`;
}

// ── Tools over the bound agent ─────────────────────────────────────

export interface AgentCapabilities {
  skillIds: readonly string[];
  mcpServerIds: readonly string[];
  tools: Record<string, boolean | undefined>;
}

export interface CapabilityRow {
  id: string;
  name: string;
  on: boolean;
  /** Comes with the agent: shown on and locked (removing it is a desktop edit). */
  fromAgent: boolean;
}

export function capabilityRows(catalog: readonly { id: string; name: string }[], fromAgent: readonly string[], added: readonly string[] | undefined, removed: readonly string[] | undefined): CapabilityRow[] {
  const agent = new Set(fromAgent.filter((id) => !(removed ?? []).includes(id)));
  const add = new Set(added ?? []);
  const known = new Map(catalog.map((c) => [c.id, c.name]));
  for (const id of [...agent, ...add]) if (!known.has(id)) known.set(id, id);
  return [...known].map(([id, name]) => ({ id, name, on: agent.has(id) || add.has(id), fromAgent: agent.has(id) })).sort((a, b) => Number(b.fromAgent) - Number(a.fromAgent) || Number(b.on) - Number(a.on) || a.name.localeCompare(b.name));
}

/** Toggle an added capability id (a from-agent one is never toggled here). */
export function toggleAdded(added: readonly string[] | undefined, id: string, on: boolean): string[] | undefined {
  const next = on ? [...new Set([...(added ?? []), id])] : (added ?? []).filter((x) => x !== id);
  return next.length ? next : undefined;
}

export type PlatformTool = 'browser' | 'computerUse' | 'widgets' | 'workflows';

/** Effective platform tools: the stage's setting, else the agent's, else the engine default. */
export function platformTools(stage: AgentStage, agent: AgentCapabilities | null): Record<PlatformTool, boolean> {
  const s = stage.session;
  const tools = s?.agentOverrides?.tools;
  return {
    browser: tools?.browser ?? agent?.tools.browser ?? false,
    computerUse: s?.computerUse ?? false,
    widgets: s?.widgets ?? tools?.widgets ?? agent?.tools.widgets ?? true,
    workflows: tools?.workflows ?? agent?.tools.workflows ?? false,
  };
}

export function setPlatformTool(stage: AgentStage, tool: PlatformTool, on: boolean): AgentStage {
  const session = { ...(stage.session ?? {}) };
  if (tool === 'computerUse') session.computerUse = on;
  else if (tool === 'widgets') session.widgets = on;
  else session.agentOverrides = { ...(session.agentOverrides ?? {}), tools: { ...(session.agentOverrides?.tools ?? {}), [tool]: on } };
  return { ...stage, session };
}

// ── Counts and keys ────────────────────────────────────────────────

export function tabCounts(stage: AgentStage, tools: Record<PlatformTool, boolean>, skillsOn: number, mcpOn: number): Partial<Record<StageTab, number>> {
  const enabledTools = Object.values(tools).filter(Boolean).length + skillsOn + mcpOn;
  return {
    prompt: stage.prompts.length,
    ...(enabledTools ? { tools: enabledTools } : {}),
    ...(stage.output.rules.length ? { output: stage.output.rules.length } : {}),
    ...(stage.hooks.length ? { hooks: stage.hooks.length } : {}),
  };
}

/** Rename a stage key through the graph: the stage, its body's parentKey, edges, context sources. */
export function renameStageKey(graph: WorkflowGraph, from: string, to: string): WorkflowGraph {
  if (from === to) return graph;
  const swap = (k: string): string => (k === from ? to : k);
  return {
    ...graph,
    stages: graph.stages.map((s) => {
      let next = s.key === from ? { ...s, key: to } : s;
      if (next.parentKey === from) next = { ...next, parentKey: to };
      if (next.kind === 'agent' && next.context.from?.includes(from)) next = { ...next, context: { ...next.context, from: next.context.from.map(swap) } };
      return next as StageSpec;
    }),
    edges: graph.edges.map((e) => (e.from === from || e.to === from ? { ...e, from: swap(e.from), to: swap(e.to) } : e)),
  };
}
