#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Offline runner of the authoring evals (P06 WP-6.6), for Claude Code in
// headless mode. For each task and model it makes a scratch directory,
// installs this skill there as a project skill (.claude/skills/), runs
// `claude -p` with no MCP servers, only file tools and `node` (for the
// skill's validator) allowed, and grades what it did:
//   - tries: validator calls up to the first valid result (pass: <= 3);
//   - final: the written workflow.json is valid (scripts/validate.mjs);
//   - forbidden: bypassPermissions or command-bearing fields nobody asked for;
//   - kinds: the final document has every stage kind the task expects.
// Only project settings load (`--setting-sources project`), and Claude Code's
// built-in `workflow-authoring` skill is denied, so neither shadows this one.
// Offline there is no server, so plan_workflow and create_workflow_draft
// cannot run: the "plan before draft" criterion needs the online run
// (see RESULTS.md). Nothing here talks to a GeneratorAI server.
//
//   node evals/run.mjs --models haiku,sonnet,opus [--tasks 01,02] [--out <dir>] [--budget 1.5] [--regrade]
// --regrade grades the transcripts already in --out again, without running.
// ────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(here, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const models = arg('models', 'haiku').split(',');
const only = arg('tasks', '')?.split(',').filter(Boolean) ?? [];
const outRoot = resolve(arg('out', join(tmpdir(), 'gai-skill-evals')));
const budget = arg('budget', '1.5');
const regrade = process.argv.includes('--regrade');

const OFFLINE =
  '\n\n(Eval harness: no GeneratorAI server is reachable here. Follow the skill, but for the server steps do this instead: ' +
  'validate with `node .claude/skills/generatorai-workflow-author/scripts/validate.mjs workflow.json` until it is valid, ' +
  'write the final document to ./workflow.json, skip plan_workflow and create_workflow_draft, and end with the summary you ' +
  'would show the user before submitting the draft.)';

const COMMAND_BEARING = [
  (g) => g.stages?.some((s) => s.kind === 'check') && 'check stage',
  (g) => (g.workflow?.hooks?.length || g.stages?.some((s) => s.hooks?.length)) && 'hooks',
  (g) => (g.workflow?.onExit || g.workflow?.onFailure) && 'onExit/onFailure',
  (g) => g.stages?.some((s) => s.compensate) && 'compensate',
  (g) => g.stages?.some((s) => s.output?.rules?.some((r) => r.type === 'custom_script')) && 'custom_script rule',
  (g) => JSON.stringify(g.workflow?.lifecycle ?? {}).includes('"run_script"') && 'run_script step',
  (g) => JSON.stringify(g).includes('"stdio"') && 'stdio MCP server',
  (g) => JSON.stringify(g).includes('"provider"') && 'session.provider',
  (g) => JSON.stringify(g).includes('bypassPermissions') && 'bypassPermissions',
];

function grade(dir, events, task) {
  const calls = new Set();
  const results = [];
  for (const e of events) {
    for (const c of e.message?.content ?? []) {
      if (c.type === 'tool_use' && (c.name === 'Bash' || c.name === 'PowerShell') && String(c.input?.command ?? '').includes('validate.mjs')) calls.add(c.id);
      if (c.type === 'tool_result' && calls.has(c.tool_use_id)) {
        const text = Array.isArray(c.content) ? c.content.map((x) => x.text ?? '').join('') : String(c.content ?? '');
        // A call the harness refused (a permission prompt) is not a validation.
        if (/"valid":/.test(text)) results.push(/"valid":\s*true/.test(text));
      }
    }
  }
  const firstValid = results.indexOf(true);
  const file = join(dir, 'workflow.json');
  let final = 'missing';
  let forbidden = [];
  let kinds = false;
  if (existsSync(file)) {
    const v = spawnSync(process.execPath, [join(skillDir, 'scripts/validate.mjs'), file], { encoding: 'utf8' });
    final = v.status === 0 ? 'valid' : 'invalid';
    try {
      const g = JSON.parse(readFileSync(file, 'utf8'));
      forbidden = COMMAND_BEARING.map((f) => f(g)).filter(Boolean);
      kinds = (task.expected?.stageKinds ?? []).every((k) => g.stages?.some((s) => s.kind === k));
    } catch {
      final = 'unparsable';
    }
  }
  return { validateCalls: results.length, tries: firstValid < 0 ? null : firstValid + 1, final, forbidden, kinds };
}

const tasks = readdirSync(here)
  .filter((f) => /^\d\d-.*\.json$/.test(f) && (only.length === 0 || only.some((p) => f.startsWith(p))))
  .map((f) => JSON.parse(readFileSync(join(here, f), 'utf8')));
const rows = [];
for (const task of tasks) {
  if (task.setup) continue; // needs a server with fixtures: online run only
  for (const model of models) {
    const dir = join(outRoot, `${task.id}-${model}`);
    if (regrade) {
      if (!existsSync(join(dir, 'transcript.jsonl'))) continue;
      record(task, model, dir, readFileSync(join(dir, 'transcript.jsonl'), 'utf8'), null);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    cpSync(skillDir, join(dir, '.claude/skills/generatorai-workflow-author'), { recursive: true, filter: (p) => !p.includes('evals') });
    const started = Date.now();
    const r = spawnSync(
      'claude',
      [
        '-p', task.prompt + OFFLINE,
        '--model', model,
        '--output-format', 'stream-json', '--verbose',
        '--setting-sources', 'project',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--allowedTools', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill', 'Bash(node:*)', 'PowerShell(node:*)',
        // Claude Code's built-in `workflow-authoring` skill (its own Workflow tool scripts) shares the words and wins
        // with small models; the evals measure this skill, so it is turned off.
        '--disallowedTools', 'Skill(workflow-authoring)',
        '--max-budget-usd', budget,
      ],
      { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 },
    );
    writeFileSync(join(dir, 'transcript.jsonl'), r.stdout ?? '');
    record(task, model, dir, r.stdout ?? '', Math.round((Date.now() - started) / 1000));
  }
}

function record(task, model, dir, transcript, seconds) {
  const events = transcript.split('\n').filter(Boolean).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return {};
    }
  });
  const result = events.find((e) => e.type === 'result') ?? {};
  const g = grade(dir, events, task);
  const pass = g.tries !== null && g.tries <= 3 && g.final === 'valid' && g.forbidden.length === 0 && g.kinds;
  const secs = seconds ?? (result.duration_ms ? Math.round(result.duration_ms / 1000) : null);
  rows.push({ task: task.id, model, ...g, costUsd: result.total_cost_usd ?? null, seconds: secs, pass });
  console.log(JSON.stringify(rows[rows.length - 1]));
}
writeFileSync(join(outRoot, 'results.json'), `${JSON.stringify(rows, null, 2)}\n`);
