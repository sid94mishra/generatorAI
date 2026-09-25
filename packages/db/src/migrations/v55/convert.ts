// ────────────────────────────────────────────────────────────────
// Migration v55 — legacy workflow rows → v2 documents (P01 WP-1.6).
//
// FROZEN with the migration (README R-3, RV-33): this module converts
// the v54 row shapes into the v2 shapes of `./spec/*` (a frozen copy of
// `@generatorai/workflow-spec`) and never imports live code. Every value
// that cannot be carried over is either repaired (a label defaulted, a
// number clamped) or dropped, and every drop is reported:
//
//   - `attention` notes flag the definition `needs_attention`: the author
//     must look (an unparseable condition, a renamed variable, a dropped
//     llm_validation rule, …). The live validator shows the rest on open.
//   - `log` notes are informational (a dead field that had no reader).
//
// Conversion rules (PHASE-01 WP-1.6 step 6, TRACKER 1.5 handoff):
//   condition            → guard, or an edge `when` when it reads the
//                          parent status (on_success / on_failure / status)
//   resultValidation +
//   index-matched workflow validations → output.rules
//   outputFormat/outputSchema/expectedOutput → output
//   contextFilter/contextSources → context (names → keys)
//   retryPolicy          → retry {maxAttempts: maxRetries + 1, …}
//   timeoutMs            → timeouts.attemptMs
//   harnessConfigOverrides/agentRef/agentMode → session
//   approvalRequired     → approval
//   {{repo_path_<a>}}    → {{run.codebases.<a>.path}}  (branch likewise)
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { RESERVED_ROOTS } from './spec/constants.js';
import { HookDefinitionSchema, PromptDefinitionSchema, ResultValidationRuleSchema, VariableDefinitionSchema, WorkflowHookDefinitionSchema } from './spec/common.js';
import { EdgeSpecSchema } from './spec/edge.js';
import { WorkflowGraphSchema } from './spec/graph.js';
import { SessionSpecSchema } from './spec/session.js';
import { AgentStageSchema } from './spec/stage.js';
import { PostProcessingStepSchema, PreprocessingStepSchema, WorkflowSpecSchema } from './spec/workflow.js';

type Json = Record<string, unknown>;

// ── Row shapes (v54) ─────────────────────────────────────────────

export interface LegacyDefinitionRow {
  id: string;
  name: string;
  description: string | null;
  version: number;
  session_mode: string | null;
  copilot_config: string | null;
  harness_config: string | null;
  variables: string | null;
  tags: string | null;
  orchestrator_config: string | null;
  project_id: string | null;
  selected_artifacts: string | null;
  use_worktree: number | null;
  hooks: string | null;
  hooks_file: string | null;
  default_agent_ref: string | null;
  skills: string | null;
  agents: string | null;
  scope: string | null;
  created_at: number;
  updated_at: number;
}

export interface LegacyStageRow {
  id: string;
  workflow_definition_id: string;
  name: string;
  description: string | null;
  template_id: string | null;
  order: number | null;
  prompts: string | null;
  copilot_config_overrides: string | null;
  harness_config_overrides: string | null;
  variables: string | null;
  hooks: string | null;
  retry_policy: string | null;
  timeout_ms: number | null;
  condition: string | null;
  context_filter: string | null;
  context_sources: string | null;
  output_format: string | null;
  agent_name: string | null;
  result_validation: string | null;
  expected_output: string | null;
  output_schema: string | null;
  iteration_config: string | null;
  approval_required: number | null;
  agent_mode: string | null;
  agent_ref: string | null;
  created_at: number;
}

export interface LegacyEdgeRow {
  id: string;
  from_stage_id: string;
  to_stage_id: string;
  edge_type: string | null;
}

export interface ConvertedStage {
  id: string;
  key: string;
  name: string;
  ordinal: number;
  spec: z.infer<typeof AgentStageSchema>;
}

export interface ConvertedDefinition {
  graph: z.infer<typeof WorkflowGraphSchema>;
  stages: ConvertedStage[];
  /** Canonical JSON of `graph` (the export format) and its sha256. */
  canonical: string;
  contentHash: string;
  /** Actionable: the definition is flagged needs_attention. */
  attention: string[];
  /** Informational: dead fields that were dropped. */
  log: string[];
}

// ── Small helpers ────────────────────────────────────────────────

export function parseJson(text: string | null | undefined): unknown {
  if (text === null || text === undefined || text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): boolean =>
  v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0) && !(isObject(v) && Object.keys(v).length === 0) && v !== '';
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * Fit `value` to `schema`: parse; on failure delete the top-level keys the
 * issues point at and try again. Returns the parsed value (or undefined) and
 * the keys it had to drop.
 */
function fit<S extends z.ZodTypeAny>(schema: S, value: unknown): { value?: z.infer<S>; dropped: string[] } {
  const dropped: string[] = [];
  let current: unknown = isObject(value) ? { ...value } : value;
  for (let i = 0; i < 25; i++) {
    const r = schema.safeParse(current);
    if (r.success) return { value: r.data, dropped };
    if (!isObject(current)) return { dropped };
    const keys = new Set(r.error.issues.map((iss) => (iss.path.length > 0 ? String(iss.path[0]) : '')));
    if (keys.has('')) {
      // An unrecognized-keys issue sits at the root and names the keys.
      for (const iss of r.error.issues) {
        if (iss.code === 'unrecognized_keys') for (const k of iss.keys) keys.add(k);
      }
      keys.delete('');
    }
    if (keys.size === 0) return { dropped };
    const next = { ...(current as Json) };
    for (const k of keys) {
      if (!(k in next)) return { dropped };
      delete next[k];
      dropped.push(k);
    }
    current = next;
  }
  return { dropped };
}

// ── Stage keys ───────────────────────────────────────────────────

export function slugKey(name: string): string {
  let s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (s === '') s = 'stage';
  if (!/^[a-z]/.test(s)) s = `s_${s}`;
  return s.slice(0, 48).replace(/_+$/, '');
}

/** Keys for stages, in (order, id) order, deduplicated with `_2`, `_3`, … */
export function assignKeys(stages: ReadonlyArray<{ id: string; name: string; order: number | null }>): Map<string, string> {
  const sorted = [...stages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const s of sorted) {
    const base = slugKey(s.name);
    let key = base;
    for (let n = 2; used.has(key); n++) {
      const suffix = `_${n}`;
      key = `${base.slice(0, 48 - suffix.length).replace(/_+$/, '')}${suffix}`;
    }
    used.add(key);
    out.set(s.id, key);
  }
  return out;
}

// ── Templates ────────────────────────────────────────────────────

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const codebasePath = (alias: string, field: 'path' | 'branch') =>
  IDENT.test(alias) ? `run.codebases.${alias}.${field}` : `run.codebases['${alias}'].${field}`;

/** `{{repo_path_<a>}}` → `{{run.codebases.<a>.path}}`, variable renames. */
export function convertTemplate(text: string, renames: ReadonlyMap<string, string>): string {
  let out = text
    .replace(/\{\{\s*repo_path_([A-Za-z0-9._-]+)\s*\}\}/g, (_m, a: string) => `{{${codebasePath(a, 'path')}}}`)
    .replace(/\{\{\s*repo_branch_([A-Za-z0-9._-]+)\s*\}\}/g, (_m, a: string) => `{{${codebasePath(a, 'branch')}}}`);
  for (const [from, to] of renames) {
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      .replace(new RegExp(`\\{\\{\\s*${esc}\\s*\\}\\}`, 'g'), `{{${to}}}`)
      .replace(new RegExp(`\\bvariables\\.${esc}\\b`, 'g'), `variables.${to}`);
  }
  return out;
}

// ── Legacy conditions → Expression v2 ────────────────────────────

export interface ConvertedCondition {
  /** Expression v2 source, or the original text when it could not be converted. */
  expr: string;
  /** Reads the source stage's status (so it belongs on an edge `when`). */
  readsParent: boolean;
  /** Could not be converted faithfully. */
  problem?: string;
}

/**
 * Convert a legacy `expression` condition. The legacy grammar: comparisons
 * `== != < <= > >=` (and the `===` spelling authors used), `AND/OR/NOT`
 * (any case) or `&& || !`, parentheses, quoted strings, numbers, `true` /
 * `false`, `status` / `parentStatus`, `variables.<path>`, `{{name}}`
 * placeholders and `stages.<Name>.<field>`.
 */
export function convertLegacyExpression(
  src: string,
  stageKeysByName: ReadonlyMap<string, string>,
  renames: ReadonlyMap<string, string>,
  declared: ReadonlySet<string> = new Set(),
): ConvertedCondition {
  const out: string[] = [];
  let readsParent = false;
  const problems: string[] = [];
  const s = src.trim();
  if (s === '') return { expr: src, readsParent: false, problem: 'empty condition' };
  let i = 0;
  const path = (p: string): string => {
    const parts = p.split('.');
    const root = parts[0]!;
    if (p === 'status' || p === 'parentStatus') {
      readsParent = true;
      return 'parent.status';
    }
    if (root === 'variables' && parts.length > 1) {
      const renamed = renames.get(parts[1]!);
      if (renamed) parts[1] = renamed;
      return parts.join('.');
    }
    if (root === 'stages' && parts.length > 1) {
      const key = stageKeysByName.get(parts[1]!) ?? stageKeysByName.get(parts[1]!.toLowerCase());
      if (!key) problems.push(`unknown stage '${parts[1]}'`);
      else parts[1] = key;
      return parts.join('.');
    }
    const lower = p.toLowerCase();
    if (lower === 'true' || lower === 'false' || lower === 'null') return lower;
    if (parts.length === 1 && IDENT.test(p)) {
      problems.push(`bare word '${p}'`);
      const name = renames.get(p) ?? p;
      return declared.has(name) ? `variables.${name}` : p;
    }
    return p;
  };
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (s.startsWith('{{', i)) {
      const end = s.indexOf('}}', i + 2);
      if (end < 0) return { expr: src, readsParent: false, problem: 'unterminated {{' };
      const inner = s.slice(i + 2, end).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(inner)) return { expr: src, readsParent: false, problem: `unsupported placeholder {{${inner}}}` };
      out.push(inner.includes('.') ? path(inner) : `variables.${renames.get(inner) ?? inner}`);
      i = end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = s.indexOf(ch, i + 1);
      if (end < 0) return { expr: src, readsParent: false, problem: 'unterminated string' };
      const body = s.slice(i + 1, end);
      out.push(`'${body.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
      i = end + 1;
      continue;
    }
    const three = s.slice(i, i + 3);
    const two = s.slice(i, i + 2);
    if (three === '===' || three === '!==') {
      out.push(three === '===' ? '==' : '!=');
      i += 3;
      continue;
    }
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      out.push(two === '&&' ? 'and' : two === '||' ? 'or' : two);
      i += 2;
      continue;
    }
    if (ch === '<' || ch === '>' || ch === '(' || ch === ')') {
      out.push(ch);
      i++;
      continue;
    }
    if (ch === '!') {
      out.push('not');
      i++;
      continue;
    }
    const num = /^-?\d+(\.\d+)?/.exec(s.slice(i));
    if (num) {
      out.push(num[0]);
      i += num[0].length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*/.exec(s.slice(i));
    if (word) {
      const w = word[0];
      const upper = w.toUpperCase();
      if (upper === 'AND' || upper === 'OR' || upper === 'NOT') {
        out.push(upper.toLowerCase());
        i += w.length;
      } else if (IDENT.test(w) && /^\s*\(/.test(s.slice(i + w.length))) {
        // A function call (`len(...)`) is already Expression v2: keep the name, glue the paren.
        out.push(`${w}(`);
        i = s.indexOf('(', i + w.length) + 1;
      } else {
        out.push(path(w));
        i += w.length;
      }
      continue;
    }
    return { expr: src, readsParent: false, problem: `unexpected '${ch}'` };
  }
  const expr = out.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/\bnot \(/g, 'not (');
  return problems.length > 0 ? { expr, readsParent, problem: problems.join('; ') } : { expr, readsParent };
}

// ── Rules ────────────────────────────────────────────────────────

/** Split a command line into words (quotes group, no expansion). */
export function splitCommandLine(line: string): string[] {
  const words: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let has = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) words.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has || cur) words.push(cur);
  return words;
}

type Rule = z.infer<typeof ResultValidationRuleSchema>;

function convertRule(raw: unknown, where: string, attention: string[]): Rule | undefined {
  if (!isObject(raw)) return undefined;
  const type = str(raw['type']);
  const message = str(raw['message'])?.slice(0, 1000) || undefined;
  const value = raw['value'];
  const withMsg = <T extends Json>(r: T) => (message ? { ...r, message } : r);
  let candidate: unknown;
  switch (type) {
    case 'contains':
    case 'not_contains':
      candidate = withMsg({ type, value: typeof value === 'string' ? value : String(value ?? '') });
      break;
    case 'min_length':
    case 'max_length':
      candidate = withMsg({ type, value: Math.max(0, Math.trunc(Number(value))) });
      break;
    case 'regex': {
      let pattern = typeof value === 'string' ? value : String(value ?? '');
      let flags: string | undefined;
      const slashed = /^\/(.*)\/([a-z]*)$/s.exec(pattern);
      if (slashed) {
        pattern = slashed[1]!;
        flags = [...new Set(slashed[2]!.split('').filter((f) => 'ims'.includes(f)))].join('') || undefined;
      }
      candidate = withMsg({ type, pattern, ...(flags ? { flags } : {}) });
      break;
    }
    case 'custom_script': {
      const words = splitCommandLine(typeof value === 'string' ? value : '');
      if (words.length === 0) {
        attention.push(`${where}: custom_script rule without a command was dropped`);
        return undefined;
      }
      candidate = withMsg({ type, command: words[0]!, args: words.slice(1) });
      break;
    }
    case 'json_schema':
      candidate = withMsg({ type, schema: isObject(value) ? value : {} });
      break;
    case 'llm_validation':
      attention.push(`${where}: llm_validation rule dropped (a judge rule arrives with the engine upgrade)`);
      return undefined;
    default:
      attention.push(`${where}: unknown rule type '${type}' dropped`);
      return undefined;
  }
  const r = ResultValidationRuleSchema.safeParse(candidate);
  if (!r.success) {
    attention.push(`${where}: ${type} rule could not be converted and was dropped`);
    return undefined;
  }
  return r.data;
}

// ── Session ──────────────────────────────────────────────────────

type Session = z.infer<typeof SessionSpecSchema>;

/** A v1 HarnessConfig (partial) → SessionSpec. */
export function harnessToSession(raw: unknown, where: string, attention: string[], log: string[]): Session | undefined {
  if (!isObject(raw)) return undefined;
  const s: Json = {};
  const copy = (from: string, to = from) => {
    if (raw[from] !== undefined && raw[from] !== null && raw[from] !== '') s[to] = raw[from];
  };
  for (const k of [
    'model',
    'systemMessage',
    'systemPromptAppend',
    'reasoningEffort',
    'contextTier',
    'harnessType',
    'maxTurns',
    'permissionMode',
    'planModeInstructions',
    'defaultAgentMode',
    'agentRef',
    'agentOverrides',
    'customAgents',
  ]) {
    copy(k);
  }
  if (s['defaultAgentMode'] === 'interactive') s['defaultAgentMode'] = 'auto';
  if (Array.isArray(s['customAgents']) && s['customAgents'].length === 0) delete s['customAgents'];
  const available = Array.isArray(raw['availableTools']) ? (raw['availableTools'] as unknown[]).filter((t) => typeof t === 'string') : [];
  const excluded = Array.isArray(raw['excludedTools']) ? (raw['excludedTools'] as unknown[]).filter((t) => typeof t === 'string') : [];
  const tools: Json = {};
  if (available.length > 0 && !(available.length === 1 && available[0] === '*')) tools['available'] = available;
  if (excluded.length > 0) tools['excluded'] = excluded;
  if (Object.keys(tools).length > 0) s['tools'] = tools;
  const mcp: Json = {};
  if (isObject(raw['mcpServers']) && Object.keys(raw['mcpServers']).length > 0) mcp['servers'] = raw['mcpServers'];
  if (Array.isArray(raw['excludedMcpServerIds']) && raw['excludedMcpServerIds'].length > 0) mcp['excludedIds'] = raw['excludedMcpServerIds'];
  if (Object.keys(mcp).length > 0) s['mcp'] = mcp;
  const skills: Json = {};
  if (Array.isArray(raw['skillDirectories']) && raw['skillDirectories'].length > 0) skills['directories'] = raw['skillDirectories'];
  if (Array.isArray(raw['disabledSkills']) && raw['disabledSkills'].length > 0) skills['disabled'] = raw['disabledSkills'];
  if (Object.keys(skills).length > 0) s['skills'] = skills;
  if (isObject(raw['browserConfig'])) s['browser'] = raw['browserConfig'];
  if (isObject(raw['provider'])) {
    const key = str(raw['provider']['apiKey']);
    if (key && key.startsWith('secretref:')) s['provider'] = raw['provider'];
    else attention.push(`${where}: provider dropped because its apiKey is not a secretref: reference`);
  }
  for (const k of ['streaming', 'configDir']) if (raw[k] !== undefined) log.push(`${where}: session field '${k}' dropped (no reader)`);
  if (Object.keys(s).length === 0) return undefined;
  const r = fit(SessionSpecSchema, s);
  if (r.dropped.length > 0) attention.push(`${where}: invalid session field(s) dropped: ${r.dropped.join(', ')}`);
  return r.value && Object.keys(r.value).length > 0 ? r.value : undefined;
}

// ── Hooks ────────────────────────────────────────────────────────

function convertHooks<S extends z.ZodTypeAny>(raw: unknown, schema: S, where: string, attention: string[]): Array<z.infer<S>> {
  if (!Array.isArray(raw)) return [];
  const out: Array<z.infer<S>> = [];
  const ids = new Set<string>();
  raw.forEach((h, i) => {
    const r = schema.safeParse(h);
    if (r.success) {
      // The first hook with an id wins (inline hooks, then the hooks file).
      const id = (r.data as { id: string }).id;
      if (!ids.has(id)) out.push(r.data);
      ids.add(id);
      return;
    }
    const phase = isObject(h) ? str(h['phase']) : undefined;
    const issue = r.error.issues[0];
    const why = issue ? `${issue.path.join('.') || 'hook'}: ${issue.message}` : 'invalid';
    attention.push(`${where}: hook ${i + 1}${phase ? ` (${phase})` : ''} dropped (${why})`);
  });
  return out;
}

// ── Workflow-level parts ─────────────────────────────────────────

type Variable = z.infer<typeof VariableDefinitionSchema>;

function convertVariables(raw: unknown, attention: string[]): { variables: Variable[]; renames: Map<string, string> } {
  const variables: Variable[] = [];
  const renames = new Map<string, string>();
  if (!Array.isArray(raw)) return { variables, renames };
  const taken = new Set<string>();
  for (const v of raw) {
    if (!isObject(v)) continue;
    const name = str(v['name']) ?? '';
    if (/^(repo_path_|repo_branch_)/.test(name)) {
      attention.push(`variable '${name}' removed: codebase paths are run.codebases.<alias>.path / .branch`);
      continue;
    }
    let next = name.replace(/^_+/, '').replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z_]/.test(next)) next = `v_${next}`;
    if ((RESERVED_ROOTS as readonly string[]).includes(next)) next = `${next}_var`;
    while (taken.has(next)) next = `${next}_2`;
    if (next !== name) {
      renames.set(name, next);
      attention.push(`variable '${name}' renamed to '${next}' (reserved or not an identifier); templates were updated`);
    }
    taken.add(next);
    const type = ['string', 'number', 'boolean', 'choice', 'text'].includes(str(v['type']) ?? '') ? (v['type'] as Variable['type']) : 'string';
    const candidate: Json = {
      name: next,
      type,
      label: (str(v['label']) || next).slice(0, 200),
      required: v['required'] === true,
    };
    if (str(v['description'])) candidate['description'] = str(v['description'])!.slice(0, 2000);
    if (v['defaultValue'] !== undefined && v['defaultValue'] !== null) candidate['defaultValue'] = v['defaultValue'];
    if (Array.isArray(v['options'])) {
      const opts = (v['options'] as unknown[]).map((o) => String(o)).filter((o) => o.length > 0 && o.length <= 200);
      if (opts.length > 0) candidate['options'] = [...new Set(opts)].slice(0, 100);
    }
    const r = fit(VariableDefinitionSchema, candidate);
    if (r.value) variables.push(r.value);
    else attention.push(`variable '${name}' could not be converted and was dropped`);
  }
  return { variables, renames };
}

const sortByOrder = (steps: unknown[]): Json[] =>
  steps.filter(isObject).map((s, i) => ({ s, i })).sort((a, b) => Number(a.s['order'] ?? 0) - Number(b.s['order'] ?? 0) || a.i - b.i).map((x) => x.s);

function convertPreprocessingStep(step: Json, ctx: CondCtx, attention: string[]): z.infer<typeof PreprocessingStepSchema> | undefined {
  const cfg = isObject(step['config']) ? { ...step['config'] } : {};
  const type = str(cfg['type']) ?? str(step['type']);
  const name = (str(step['name']) || type || 'Step').slice(0, 200);
  let config: Json | undefined;
  switch (type) {
    case 'clone_repo':
      config = { type, repoAlias: cfg['repoAlias'] };
      break;
    case 'run_script':
      config = {
        type,
        script: cfg['script'],
        ...(str(cfg['cwd']) ? { cwd: cfg['cwd'] } : {}),
        ...(typeof cfg['timeoutMs'] === 'number' ? { timeoutMs: clamp(Math.trunc(cfg['timeoutMs']), 1000, 3_600_000) } : {}),
      };
      break;
    case 'set_variable':
      config = { type, variableName: ctx.renames.get(str(cfg['variableName']) ?? '') ?? cfg['variableName'], value: convertTemplate(str(cfg['value']) ?? '', ctx.renames) };
      break;
    case 'validate_input': {
      const rules = (Array.isArray(cfg['rules']) ? cfg['rules'] : []).filter(isObject).flatMap((r) => {
        const message = (str(r['message']) || 'Invalid value').slice(0, 1000);
        switch (r['type']) {
          case 'required':
            return [{ type: 'required', message }];
          case 'regex':
            return [{ type: 'regex', pattern: String(r['value'] ?? ''), message }];
          case 'min_length':
          case 'max_length':
            return [{ type: r['type'], value: Math.max(0, Math.trunc(Number(r['value']))), message }];
          default:
            attention.push(`preprocessing step '${name}': input rule '${String(r['type'])}' dropped`);
            return [];
        }
      });
      const variableName = str(cfg['variableName']) ?? '';
      config = { type, variableName: ctx.renames.get(variableName) ?? variableName, rules };
      break;
    }
    case 'conditional': {
      const cond = convertLegacyExpression(str(cfg['condition']) ?? '', ctx.stageKeysByName, ctx.renames, ctx.declared);
      if (cond.problem) attention.push(`preprocessing step '${name}': condition '${str(cfg['condition'])}' needs review (${cond.problem})`);
      const sub = (list: unknown) =>
        sortByOrder(Array.isArray(list) ? list : []).flatMap((s) => {
          const c = convertPreprocessingStep(s, ctx, attention);
          return c ? [c] : [];
        });
      config = { type, condition: cond.expr || 'false', thenSteps: sub(cfg['thenSteps']), ...(Array.isArray(cfg['elseSteps']) ? { elseSteps: sub(cfg['elseSteps']) } : {}) };
      break;
    }
    default:
      attention.push(`preprocessing step '${name}': unknown type '${type}' dropped`);
      return undefined;
  }
  const r = PreprocessingStepSchema.safeParse({ name, failOnError: step['failOnError'] !== false, config });
  if (!r.success) {
    attention.push(`preprocessing step '${name}' could not be converted and was dropped`);
    return undefined;
  }
  return r.data;
}

function convertPostProcessingStep(step: Json, renames: ReadonlyMap<string, string>, attention: string[], log: string[]): z.infer<typeof PostProcessingStepSchema> | undefined {
  const cfg = isObject(step['config']) ? { ...step['config'] } : {};
  const type = str(cfg['type']) ?? str(step['type']);
  const name = (str(step['name']) || type || 'Step').slice(0, 200);
  if (step['enabled'] === false) {
    log.push(`post-processing step '${name}' was disabled and is not carried over (every declared step runs now)`);
    return undefined;
  }
  let config: Json | undefined;
  const opt = (k: string) => (cfg[k] !== undefined && cfg[k] !== null && cfg[k] !== '' ? { [k]: cfg[k] } : {});
  switch (type) {
    case 'commit_and_push':
      config = { type, commitMessage: convertTemplate(str(cfg['commitMessage']) || 'Workflow changes', renames), ...opt('repoAlias'), ...opt('push'), ...opt('generateMessage'), ...opt('baseBranch') };
      break;
    case 'create_pr':
      config = {
        type,
        title: convertTemplate(str(cfg['title']) || 'Workflow changes', renames),
        body: convertTemplate(str(cfg['body']) ?? '', renames),
        ...opt('repoAlias'),
        ...opt('baseBranch'),
        ...opt('generateText'),
        ...opt('draft'),
      };
      break;
    case 'run_script':
      config = { type, script: cfg['script'], ...opt('cwd'), ...(typeof cfg['timeoutMs'] === 'number' ? { timeoutMs: clamp(Math.trunc(cfg['timeoutMs']), 1000, 3_600_000) } : {}) };
      break;
    default:
      attention.push(`post-processing step '${name}': unknown type '${type}' dropped`);
      return undefined;
  }
  const r = PostProcessingStepSchema.safeParse({ name, failOnError: step['failOnError'] !== false, config });
  if (!r.success) {
    attention.push(`post-processing step '${name}' could not be converted and was dropped`);
    return undefined;
  }
  return r.data;
}

interface CondCtx {
  stageKeysByName: ReadonlyMap<string, string>;
  renames: ReadonlyMap<string, string>;
  declared: ReadonlySet<string>;
}

const EDGE_ON: Record<string, 'success' | 'failure' | 'completion' | 'always'> = {
  on_success: 'success',
  on_failure: 'failure',
  on_completion: 'completion',
  always: 'always',
};

// ── The definition ───────────────────────────────────────────────

export function convertLegacyDefinition(def: LegacyDefinitionRow, stageRows: LegacyStageRow[], edgeRows: LegacyEdgeRow[]): ConvertedDefinition {
  const attention: string[] = [];
  const log: string[] = [];

  const keys = assignKeys(stageRows);
  const ordered = [...stageRows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  const stageKeysByName = new Map<string, string>();
  for (const s of ordered) {
    const key = keys.get(s.id)!;
    if (!stageKeysByName.has(s.name)) stageKeysByName.set(s.name, key);
    if (!stageKeysByName.has(s.name.toLowerCase())) stageKeysByName.set(s.name.toLowerCase(), key);
    stageKeysByName.set(key, key);
  }

  // Workflow-level JSON.
  const orch = parseJson(def.orchestrator_config);
  const oc: Json = isObject(orch) ? orch : {};
  const { variables, renames } = convertVariables(parseJson(def.variables), attention);
  const ctx: CondCtx = { stageKeysByName, renames, declared: new Set(variables.map((v) => v.name)) };

  const hooksFile = parseJson(def.hooks_file);
  const hf: Json = isObject(hooksFile) ? hooksFile : {};
  const workflowHooks = convertHooks(
    [...(Array.isArray(parseJson(def.hooks)) ? (parseJson(def.hooks) as unknown[]) : []), ...(Array.isArray(hf['workflow']) ? hf['workflow'] : [])],
    WorkflowHookDefinitionSchema,
    'workflow',
    attention,
  );
  const stageHooksFromFile: Json = isObject(hf['stages']) ? hf['stages'] : {};

  const workflowSession = harnessToSession(parseJson(def.harness_config) ?? parseJson(def.copilot_config), 'workflow session', attention, log);
  const session: Json = { ...(workflowSession ?? {}) };
  if (def.default_agent_ref && !session['agentRef']) session['agentRef'] = def.default_agent_ref;

  if (def.session_mode && def.session_mode !== 'auto') {
    log.push(`session mode '${def.session_mode}' dropped: every run resolves its session mode from the graph shape until stage session groups arrive`);
  }
  for (const [col, v] of [
    ['selected_artifacts', parseJson(def.selected_artifacts)],
    ['skills', parseJson(def.skills)],
    ['agents', parseJson(def.agents)],
  ] as const) {
    if (nonEmpty(v)) log.push(`definition ${col} dropped (PD-11: use session.agentRef)`);
  }

  // Workflow validations, index-matched to the stages in `order` order.
  const rulesByIndex = new Map<number, unknown[]>();
  for (const rv of Array.isArray(oc['resultValidations']) ? (oc['resultValidations'] as unknown[]) : []) {
    if (!isObject(rv)) continue;
    const idx = Number(rv['stageIndex']);
    if (!Number.isInteger(idx) || idx < 0 || idx >= ordered.length) {
      attention.push(`workflow validation for stage index ${String(rv['stageIndex'])} dropped: no such stage`);
      continue;
    }
    rulesByIndex.set(idx, [...(rulesByIndex.get(idx) ?? []), ...(Array.isArray(rv['rules']) ? rv['rules'] : [])]);
  }

  // Incoming edges per stage (for conditions that read the parent status).
  const edgeSpecs: Array<{ id: string; from: string; to: string; on: 'success' | 'failure' | 'completion' | 'always'; when?: string }> = [];
  const seenPairs = new Set<string>();
  for (const e of edgeRows) {
    const from = keys.get(e.from_stage_id);
    const to = keys.get(e.to_stage_id);
    if (!from || !to) {
      attention.push(`edge ${e.id} dropped: it references a missing stage`);
      continue;
    }
    if (from === to) {
      attention.push(`edge ${from} → ${to} dropped: a stage cannot depend on itself`);
      continue;
    }
    if (seenPairs.has(`${from}>${to}`)) {
      attention.push(`duplicate edge ${from} → ${to} dropped`);
      continue;
    }
    seenPairs.add(`${from}>${to}`);
    edgeSpecs.push({ id: e.id, from, to, on: EDGE_ON[e.edge_type ?? 'on_success'] ?? 'success' });
  }

  const stages: ConvertedStage[] = [];
  ordered.forEach((row, index) => {
    const key = keys.get(row.id)!;
    const where = `stage '${row.name}'`;
    const spec: Json = { kind: 'agent', key, name: (row.name || key).slice(0, 200) };
    if (row.description) spec['description'] = row.description.slice(0, 2000);

    // prompts
    const prompts: unknown[] = [];
    (Array.isArray(parseJson(row.prompts)) ? (parseJson(row.prompts) as unknown[]) : []).forEach((p, i) => {
      if (!isObject(p)) return;
      const text = convertTemplate(str(p['text']) ?? '', renames);
      if (text.trim() === '') {
        attention.push(`${where}: empty prompt ${i + 1} dropped`);
        return;
      }
      const r = PromptDefinitionSchema.safeParse({ label: (str(p['label']) || `Prompt ${i + 1}`).slice(0, 200), text });
      if (r.success) prompts.push(r.data);
      else attention.push(`${where}: prompt ${i + 1} could not be converted and was dropped`);
    });
    spec['prompts'] = prompts;

    // session
    const stageSession: Json = { ...(harnessToSession(parseJson(row.harness_config_overrides) ?? parseJson(row.copilot_config_overrides), `${where} session`, attention, log) ?? {}) };
    if (row.agent_ref) stageSession['agentRef'] = row.agent_ref;
    if (row.agent_mode) stageSession['defaultAgentMode'] = row.agent_mode === 'plan' ? 'plan' : 'auto';
    if (Object.keys(stageSession).length > 0) {
      const r = fit(SessionSpecSchema, stageSession);
      if (r.value) spec['session'] = r.value;
      if (r.dropped.length > 0) attention.push(`${where}: invalid session field(s) dropped: ${r.dropped.join(', ')}`);
    }
    if (row.agent_name && !row.agent_ref) attention.push(`${where}: agent name '${row.agent_name}' dropped; bind the agent with session.agentRef`);

    // context
    const ctxMode = ({ 'summary-only': 'summary', full: 'output', structured: 'structured', none: 'none' } as Record<string, string>)[row.context_filter ?? 'summary-only'] ?? 'summary';
    const context: Json = { mode: ctxMode };
    const sources = parseJson(row.context_sources);
    if (Array.isArray(sources)) {
      if (sources.length === 0) context['mode'] = 'none';
      else {
        const from = sources.flatMap((n) => {
          const k = stageKeysByName.get(String(n)) ?? stageKeysByName.get(String(n).toLowerCase());
          if (!k) attention.push(`${where}: context source '${String(n)}' dropped: no such stage`);
          return k && k !== key ? [k] : [];
        });
        if (from.length > 0) context['from'] = [...new Set(from)];
        // No source matched, so the stage received no context: keep that.
        else context['mode'] = 'none';
      }
    }
    spec['context'] = context;

    // output
    const rules = [...(Array.isArray(parseJson(row.result_validation)) ? (parseJson(row.result_validation) as unknown[]) : []), ...(rulesByIndex.get(index) ?? [])]
      .map((r, i) => convertRule(r, `${where} rule ${i + 1}`, attention))
      .filter((r): r is Rule => r !== undefined)
      .slice(0, 20);
    const output: Json = { format: row.output_format === 'json' ? 'json' : 'text', rules };
    const schema = parseJson(row.output_schema);
    if (isObject(schema)) output['schema'] = schema;
    if (row.expected_output) {
      const instructions = convertTemplate(row.expected_output, renames);
      if (instructions.length > 5000) attention.push(`${where}: expected output text shortened to 5000 characters`);
      output['instructions'] = instructions.slice(0, 5000);
    }
    spec['output'] = output;

    // retry / timeouts / approval
    const rp = parseJson(row.retry_policy);
    if (isObject(rp) && Number(rp['maxRetries']) > 0) {
      spec['retry'] = {
        maxAttempts: clamp(Math.trunc(Number(rp['maxRetries'])) + 1, 1, 10),
        initialDelayMs: clamp(Math.trunc(Number(rp['backoffMs'] ?? 2000)) || 0, 0, 3_600_000),
        backoffMultiplier: clamp(Number(rp['backoffMultiplier'] ?? 2) || 1, 1, 10),
      };
    }
    if (row.timeout_ms !== null && row.timeout_ms > 0) spec['timeouts'] = { attemptMs: clamp(Math.trunc(row.timeout_ms), 1000, 86_400_000) };
    if (row.approval_required === 1) spec['approval'] = {};

    // hooks
    spec['hooks'] = convertHooks(
      [
        ...(Array.isArray(parseJson(row.hooks)) ? (parseJson(row.hooks) as unknown[]) : []),
        // hooks-file entries: by stage name, then the '*' wildcard (the v1 resolution order)
        ...(Array.isArray(stageHooksFromFile[row.name]) ? (stageHooksFromFile[row.name] as unknown[]) : []),
        ...(Array.isArray(stageHooksFromFile['*']) ? (stageHooksFromFile['*'] as unknown[]) : []),
      ],
      HookDefinitionSchema,
      where,
      attention,
    );

    // dead fields
    if (nonEmpty(parseJson(row.variables))) log.push(`${where}: stage variables dropped (definition variables replace them)`);
    if (row.template_id) log.push(`${where}: stage template '${row.template_id}' reference dropped`);
    if (nonEmpty(parseJson(row.iteration_config))) log.push(`${where}: iteration config dropped (loop stages arrive with the control-flow upgrade)`);

    // condition
    const cond = parseJson(row.condition);
    if (isObject(cond)) {
      const incoming = edgeSpecs.filter((e) => e.to === key);
      const addWhen = (expr: string, implied: 'success' | 'failure' | null) => {
        for (const e of incoming) if (e.on !== implied) e.when = e.when ? `(${e.when}) and (${expr})` : expr;
      };
      switch (cond['type']) {
        case 'always':
        case undefined:
          break;
        case 'on_success':
          if (incoming.length > 0) addWhen("parent.status == 'completed'", 'success');
          break;
        case 'on_failure':
          if (incoming.length > 0) addWhen("parent.status == 'failed'", 'failure');
          else {
            spec['guard'] = 'false';
            attention.push(`${where}: an on_failure condition on a stage with no predecessor never held; kept as guard 'false'`);
          }
          break;
        case 'expression': {
          const src = str(cond['expression']) ?? '';
          const c = convertLegacyExpression(src, stageKeysByName, renames, ctx.declared);
          if (c.problem) attention.push(`${where}: condition '${src}' needs review (${c.problem})`);
          if (c.readsParent && incoming.length > 0) addWhen(c.expr, null);
          else spec['guard'] = c.readsParent ? c.expr.replace(/\bparent\.status\b/g, "'completed'") : c.expr;
          break;
        }
        default:
          attention.push(`${where}: unknown condition type '${String(cond['type'])}' dropped`);
      }
    }

    const parsed = fit(AgentStageSchema, spec);
    if (parsed.dropped.length > 0) attention.push(`${where}: invalid field(s) dropped: ${parsed.dropped.join(', ')}`);
    const value = parsed.value ?? AgentStageSchema.parse({ kind: 'agent', key, name: spec['name'] });
    stages.push({ id: row.id, key, name: value.name, ordinal: index, spec: value });
  });

  // Lifecycle.
  const pre = sortByOrder(Array.isArray(oc['preprocessingSteps']) ? (oc['preprocessingSteps'] as unknown[]) : []).flatMap((s) => {
    const c = convertPreprocessingStep(s, ctx, attention);
    return c ? [c] : [];
  });
  const post = sortByOrder(Array.isArray(oc['postProcessingSteps']) ? (oc['postProcessingSteps'] as unknown[]) : []).flatMap((s) => {
    const c = convertPostProcessingStep(s, renames, attention, log);
    return c ? [c] : [];
  });
  const lifecycle = {
    codebaseAliases: Array.isArray(oc['codebaseAliases']) ? [...new Set((oc['codebaseAliases'] as unknown[]).filter((a): a is string => typeof a === 'string' && /^[A-Za-z0-9._-]{1,50}$/.test(a)))].slice(0, 5) : [],
    useWorktree: def.use_worktree !== 0,
    requiresCodebase: oc['requiresCodebase'] === true,
    preprocessingSteps: pre,
    postProcessing: { autoCommit: oc['autoCommit'] === true, autoPush: oc['autoPush'] === true, autoCreatePR: oc['autoCreatePR'] === true, steps: post },
  };

  const tags = Array.isArray(parseJson(def.tags)) ? (parseJson(def.tags) as unknown[]).filter((t): t is string => typeof t === 'string' && t.length > 0 && t.length <= 50).slice(0, 20) : [];
  const workflowCandidate: Json = {
    name: (def.name || 'Untitled workflow').slice(0, 200),
    ...(def.description ? { description: def.description.slice(0, 2000) } : {}),
    session,
    variables,
    hooks: workflowHooks,
    lifecycle,
    tags,
    ...(def.project_id ? { projectId: def.project_id } : {}),
  };
  const wf = fit(WorkflowSpecSchema, workflowCandidate);
  if (wf.dropped.length > 0) attention.push(`workflow: invalid field(s) dropped: ${wf.dropped.join(', ')}`);
  const workflow = wf.value ?? WorkflowSpecSchema.parse({ name: workflowCandidate['name'] });

  const edges = edgeSpecs.flatMap((e) => {
    const r = EdgeSpecSchema.safeParse({ from: e.from, to: e.to, on: e.on, ...(e.when ? { when: e.when } : {}) });
    if (r.success) return [r.data];
    attention.push(`edge ${e.from} → ${e.to} could not be converted and was dropped`);
    return [];
  });

  const graph = WorkflowGraphSchema.parse({ formatVersion: 2, workflow, stages: stages.map((s) => s.spec), edges });
  const canonical = `${JSON.stringify(graph, null, 2)}\n`;
  return {
    graph,
    stages,
    canonical,
    contentHash: createHash('sha256').update(canonical).digest('hex'),
    attention,
    log,
  };
}

// ── Automations (PD-8, RV-22) ────────────────────────────────────

export interface LegacyAutomationRow {
  id: string;
  input_mode: string | null;
  loop_variable: string | null;
  loop_items: string | null;
  batch_data_format: string | null;
  batch_data: string | null;
  batch_columns: string | null;
  batch_column_mapping: string | null;
  data_source_config: string | null;
  data_schema: string | null;
}

export interface ConvertedAutomation {
  /** New schema-driven columns, or undefined when nothing changes. */
  update?: { dataSchema: Json; iterationMode: Json; defaultDataset: Json };
  disable: boolean;
  log: string[];
}

/** Minimal RFC 4180 CSV parser (quoted fields, "" escapes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function fieldType(values: unknown[]): 'string' | 'number' | 'boolean' | 'json' {
  if (values.length > 0 && values.every((v) => typeof v === 'number')) return 'number';
  if (values.length > 0 && values.every((v) => typeof v === 'boolean')) return 'boolean';
  if (values.every((v) => typeof v === 'string' || v === null || v === undefined)) return 'string';
  return 'json';
}

export function convertLegacyAutomation(row: LegacyAutomationRow): ConvertedAutomation {
  const log: string[] = [];
  const mode = row.input_mode ?? 'single';
  if (row.data_schema) {
    if (mode !== 'single') log.push(`legacy input mode '${mode}' dropped: the automation already has a data schema`);
    return { disable: false, log };
  }
  if (mode === 'single') {
    if (nonEmpty(parseJson(row.data_source_config))) log.push('data source config dropped (no reader)');
    return { disable: false, log };
  }
  const fail = (why: string): ConvertedAutomation => ({ disable: true, log: [...log, `disabled: ${why}`] });
  const toRows = (objs: Json[]): ConvertedAutomation => {
    const names = [...new Set(objs.flatMap((o) => Object.keys(o)))];
    if (objs.length === 0 || names.length === 0) return fail(`the ${mode} input has no rows`);
    const bad = names.filter((n) => !FIELD_NAME.test(n));
    if (bad.length > 0) return fail(`field name(s) ${bad.join(', ')} are not identifiers`);
    const fields = names.map((name) => ({ name, type: fieldType(objs.map((o) => o[name])), required: objs.every((o) => o[name] !== undefined && o[name] !== null) }));
    log.push(`converted ${mode} input (${objs.length} row${objs.length === 1 ? '' : 's'}) to a data schema and default dataset`);
    return {
      update: {
        dataSchema: { version: 1, format: 'json_array', fields },
        iterationMode: { kind: 'each_row' },
        defaultDataset: { format: 'json_array', data: JSON.stringify(objs), parsedRowCount: objs.length },
      },
      disable: false,
      log,
    };
  };
  if (mode === 'loop') {
    const variable = row.loop_variable ?? '';
    const items = parseJson(row.loop_items);
    if (!FIELD_NAME.test(variable)) return fail(`loop variable '${variable}' is not an identifier`);
    if (!Array.isArray(items)) return fail('loop items are not a list');
    return toRows(items.map((it) => ({ [variable]: it })));
  }
  if (mode === 'batch') {
    const mapping = parseJson(row.batch_column_mapping);
    const map: Record<string, string> = isObject(mapping) ? Object.fromEntries(Object.entries(mapping).filter(([, v]) => typeof v === 'string' && v !== '')) as Record<string, string> : {};
    const rename = (o: Json): Json => Object.fromEntries(Object.entries(o).map(([k, v]) => [map[k] ?? k, v]));
    const data = row.batch_data ?? '';
    const format = row.batch_data_format ?? 'json';
    let objs: Json[];
    if (format === 'json') {
      const parsed = parseJson(data);
      if (!Array.isArray(parsed) || !parsed.every(isObject)) return fail('batch data is not a JSON array of objects');
      objs = parsed as Json[];
    } else if (format === 'jsonl') {
      objs = [];
      for (const line of data.split(/\r?\n/)) {
        if (line.trim() === '') continue;
        const o = parseJson(line);
        if (!isObject(o)) return fail('batch data has a JSONL line that is not an object');
        objs.push(o);
      }
    } else if (format === 'csv') {
      const rows = parseCsv(data);
      if (rows.length < 2) return fail('batch CSV has no data rows');
      const header = rows[0]!.map((h) => h.trim());
      objs = rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
    } else return fail(`batch format '${format}' is unknown`);
    return toRows(objs.map(rename));
  }
  return fail(`input mode '${mode}' has no schema-driven equivalent`);
}
