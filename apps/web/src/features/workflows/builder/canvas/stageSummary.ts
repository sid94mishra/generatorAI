// ────────────────────────────────────────────────────────────────
// stageSummary — what a stage node shows, read from the fields the
// inspector writes (D-30): the two body lines (who runs it, on what) and
// the pill row (prompts, output, rules, approval, guard, join, retry,
// timeouts, skills, MCP servers, loop session reuse, planner). Each pill
// names the JSON pointer it summarises so a validation issue on that field
// can mark it. Pure: no React, no store.
// ────────────────────────────────────────────────────────────────

import type { IconConcept } from '@generatorai/design-tokens';
import type { StageSpec } from '@generatorai/workflow-spec';

export interface StagePill {
  id: string;
  label: string;
  icon?: IconConcept;
  /** The tooltip: the full statement the short label stands for. */
  tooltip: string;
  mono?: boolean;
  tone?: 'neutral' | 'warn';
  /** JSON pointer (relative to the stage) of the field it summarises. */
  field?: string;
}

export interface StageLines {
  /** First line: the agent, or what the kind runs. */
  lead: { icon: IconConcept; text: string; muted?: boolean };
  /** Second line, mono: model, command, wait target, child workflow. */
  detail: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** 90000 → "1m 30s", 300000 → "5m", 5400000 → "1h 30m". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/** What a node knows of a bound agent: its display name and the model it pins. */
export interface AgentInfo {
  name: string;
  model?: string | undefined;
}

/**
 * The body lines of a stage node. `agentOf` resolves an agent ref: its name, and its own model, shown when the
 * stage pins none (cards read "default model" for agents pinned to Opus or Terra; evaluation 2026-10-20).
 */
export function stageLines(stage: StageSpec, agentOf: (ref: string) => AgentInfo | undefined): StageLines {
  switch (stage.kind) {
    case 'agent': {
      const ref = stage.session?.agentRef;
      const agent = ref ? agentOf(ref) : undefined;
      const model = stage.session?.model ?? agent?.model;
      const effort = stage.session?.reasoningEffort;
      return {
        lead: ref
          ? { icon: 'agents', text: agent?.name ?? ref }
          : { icon: 'agents', text: 'No agent · model only', muted: true },
        detail: `${model ?? 'default model'}${effort ? ` · ${effort}` : ''}`,
      };
    }
    case 'check':
      return { lead: { icon: 'terminal', text: 'Check · no LLM' }, detail: [stage.check.command, ...stage.check.args].join(' ') };
    case 'wait': {
      const w = stage.wait;
      if (w.type === 'approval') return { lead: { icon: 'hand', text: 'Wait · approval' }, detail: w.prompt.label };
      if (w.type === 'event') return { lead: { icon: 'webhook', text: 'Wait · event' }, detail: w.eventKey };
      return { lead: { icon: 'hourglass', text: 'Wait · timer' }, detail: formatDuration(w.durationMs) };
    }
    case 'subworkflow': {
      const sub = stage.subworkflow;
      const ref = 'id' in sub.workflowRef ? sub.workflowRef.id : sub.workflowRef.name;
      return {
        lead: { icon: 'workflows', text: 'Sub-workflow' },
        detail: `${ref}${typeof sub.version === 'number' ? ` · v${sub.version}` : ''}`,
      };
    }
    default:
      return { lead: { icon: 'workflows', text: stage.kind }, detail: null };
  }
}

function guardPill(stage: StageSpec): StagePill[] {
  return stage.guard ? [{ id: 'guard', label: 'Guard', icon: 'variable', tooltip: `Guard: ${stage.guard}`, field: '/guard' }] : [];
}

function joinPill(stage: StageSpec): StagePill[] {
  const join = stage.join;
  if (!join || join.mode === 'all') return [];
  const label = join.mode === 'any' ? 'Join any' : `Join ${join.n} of m`;
  const tooltip =
    join.mode === 'any'
      ? 'Ready once the first predecessor is satisfied'
      : `Ready once ${join.n} predecessors are satisfied`;
  return [{ id: 'join', label, icon: 'branch', tooltip: `${tooltip}${join.cancelRemaining ? '; cancels the rest' : ''}`, field: '/join' }];
}

function retryPill(retry: { maxAttempts: number } | undefined): StagePill[] {
  return retry
    ? [{ id: 'retry', label: `Retry ${retry.maxAttempts}×`, icon: 'retry', tooltip: `Retry policy: up to ${retry.maxAttempts} attempts`, field: '/retry' }]
    : [];
}

/** The pill row of a stage node. `inLoopBody`: the stage sits inside a container. */
export function stagePills(stage: StageSpec, inLoopBody: boolean): StagePill[] {
  const pills: StagePill[] = [];
  if (stage.kind === 'agent') {
    const n = stage.prompts.length;
    pills.push({ id: 'prompts', label: plural(n, 'prompt'), icon: 'file-text', tooltip: plural(n, 'prompt turn'), field: '/prompts' });
    const followUps = stage.followUpPrompts?.length ?? 0;
    if (followUps > 0) {
      pills.push({ id: 'follow-up', label: `Follow-up ${followUps}`, icon: 'message', tooltip: plural(followUps, 'follow-up prompt'), field: '/followUpPrompts' });
    }
    if (inLoopBody) {
      const cont = stage.sessionReuse === 'continue';
      pills.push({
        id: 'session-reuse',
        label: cont ? 'Continue' : 'Fresh',
        icon: 'message',
        tooltip: cont
          ? `Continues one conversation across iterations${stage.compactAfter ? `, compacted every ${stage.compactAfter}` : ''}`
          : 'Starts a fresh conversation each iteration',
        field: '/sessionReuse',
      });
    }
    if (stage.output.format === 'json') {
      pills.push({ id: 'json', label: 'JSON', mono: true, tooltip: 'Produces structured JSON output', field: '/output' });
    }
    const rules = stage.output.rules.length;
    if (rules > 0) {
      pills.push({ id: 'rules', label: plural(rules, 'rule'), icon: 'check', tooltip: plural(rules, 'result-validation rule'), field: '/output/rules' });
    }
    if (stage.approval) {
      pills.push({ id: 'approval', label: 'Approval', icon: 'hand', tone: 'warn', tooltip: 'Waits for approval before successors start', field: '/approval' });
    }
    pills.push(...guardPill(stage), ...joinPill(stage), ...retryPill(stage.retry));
    const t = stage.timeouts;
    const limit = t?.totalMs ?? t?.attemptMs;
    if (t && limit) {
      const parts = [
        t.attemptMs ? `attempt ${formatDuration(t.attemptMs)}` : null,
        t.idleMs ? `idle ${formatDuration(t.idleMs)}` : null,
        t.totalMs ? `total ${formatDuration(t.totalMs)}` : null,
        t.queueMs ? `queue ${formatDuration(t.queueMs)}` : null,
      ].filter(Boolean);
      pills.push({ id: 'timeouts', label: formatDuration(limit), icon: 'clock', tooltip: `Timeouts: ${parts.join(' · ')}`, field: '/timeouts' });
    }
    const skills = stage.session?.agentOverrides?.addSkillIds?.length ?? 0;
    if (skills > 0) {
      pills.push({ id: 'skills', label: plural(skills, 'skill'), icon: 'skills', tooltip: `${plural(skills, 'skill')} enabled`, field: '/session/agentOverrides' });
    }
    for (const server of Object.keys(stage.session?.mcp?.servers ?? {})) {
      pills.push({ id: `mcp:${server}`, label: server, icon: 'mcp', tooltip: `MCP server ${server}`, field: '/session/mcp' });
    }
    const excluded = stage.session?.mcp?.excludedIds?.length ?? 0;
    if (excluded > 0) {
      pills.push({ id: 'mcp-excluded', label: `MCP −${excluded}`, icon: 'mcp', tooltip: `${plural(excluded, 'MCP server')} excluded`, field: '/session/mcp' });
    }
    if (stage.expands) {
      const max = stage.expands.maxStages;
      pills.push({
        id: 'expands',
        label: `Plans ≤${max}`,
        icon: 'list',
        tooltip: `Plans up to ${plural(max, 'agent stage')} at run time${stage.expands.join === 'tolerate' ? ' · tolerates failures' : ''}`,
        field: '/expands',
      });
    }
    return pills;
  }
  if (stage.kind === 'check') {
    pills.push({ id: 'admin', label: 'Admin only', icon: 'lock', tooltip: 'Saving a check stage needs the admin:settings scope' });
    if (stage.check.parseJson) pills.push({ id: 'json', label: 'JSON', mono: true, tooltip: 'Parses stdout as JSON', field: '/check/parseJson' });
    pills.push(...guardPill(stage), ...joinPill(stage), ...retryPill(stage.retry));
    if (stage.check.timeoutMs) {
      pills.push({ id: 'timeouts', label: formatDuration(stage.check.timeoutMs), icon: 'clock', tooltip: `Command timeout ${formatDuration(stage.check.timeoutMs)}`, field: '/check/timeoutMs' });
    }
    return pills;
  }
  if (stage.kind === 'wait') {
    const w = stage.wait;
    if (w.type !== 'timer' && w.timeoutMs) {
      pills.push({ id: 'timeouts', label: formatDuration(w.timeoutMs), icon: 'clock', tooltip: `Times out after ${formatDuration(w.timeoutMs)}`, field: '/wait/timeoutMs' });
    }
    pills.push(...guardPill(stage), ...joinPill(stage));
    return pills;
  }
  if (stage.kind === 'subworkflow') {
    const sub = stage.subworkflow;
    pills.push({
      id: 'workspace',
      label: sub.workspace === 'inherit' ? 'Run mounts' : 'Own workspace',
      icon: 'folder-open',
      tooltip: sub.workspace === 'inherit' ? "Works in this run's mounts" : 'Runs in its own workspace',
      field: '/subworkflow/workspace',
    });
    pills.push(...guardPill(stage), ...joinPill(stage));
    return pills;
  }
  return [...guardPill(stage), ...joinPill(stage)];
}
