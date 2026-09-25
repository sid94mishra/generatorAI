// ────────────────────────────────────────────────────────────────
// Migration v55 `workflow_definitions_v2` (workflow overhaul P01 WP-1.6).
//
// Builds a v54 database through the real migrations, fills it with a frozen
// fixture (chats, an orchestrator worker chat, a stage session with its
// transcript, two definitions with every conversion case, a run with stage
// runs, three automations) and migrates it. Chat rows, their messages and
// chat sessions must come through unchanged (README R-3); run history goes.
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { closeDB, createDB, type AppDatabase } from '../index.js';
import { migrateDB } from '../migrations/index.js';
import { AgentStageSchema } from '../migrations/v55/spec/stage.js';
import { WorkflowGraphSchema } from '../migrations/v55/spec/graph.js';
import { WorkflowSpecSchema } from '../migrations/v55/spec/workflow.js';

const open: AppDatabase[] = [];
afterEach(() => {
  for (const db of open.splice(0)) closeDB(db);
});

const raw = (db: AppDatabase): Database.Database =>
  (db as unknown as { session: { client: Database.Database } }).session.client;

const T = 1_790_000_000; // seconds, like every drizzle `timestamp` column

/** The frozen v54 fixture. */
function seedV54(s: Database.Database): void {
  const session = s.prepare(
    `INSERT INTO sessions (id, name, status, created_at, updated_at, conversation_id, owner_type, owner_id, repo_url, workspace_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  session.run('s-c1', 'Chat one', 'active', T, T, 'conv-c1', 'chat', 'c1', 'https://example.test/r.git', 'C:/w/c1');
  session.run('s-c2', 'Chat two', 'active', T, T, 'conv-c2', 'chat', 'c2', null, null);
  session.run('s-worker', 'Worker', 'active', T, T, 'conv-w', 'chat', 'c-worker', null, null);
  session.run('s-stage', 'Stage session', 'closed', T, T, 'conv-stage', 'stage_run', 'sr-1', null, null);

  const chat = s.prepare(
    `INSERT INTO chats (id, name, session_id, created_at, updated_at, copilot_config, harness_config, default_agent_mode, parent_chat_id, orchestrator_mode, source_control)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  chat.run('c1', 'Orchestrator chat', 's-c1', T, T, '{"model":"x"}', '{"model":"claude"}', 'plan', null, 1, '{"commit":true}');
  chat.run('c2', 'Empty chat', 's-c2', T, T + 1, null, null, 'auto', null, 0, null);
  chat.run('c-worker', 'Worker chat', 's-worker', T, T, null, null, 'auto', 'c1', 0, null);

  const msg = s.prepare(`INSERT INTO chat_messages (id, session_id, role, content, timestamp, chat_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  msg.run('m1', 's-c1', 'user', 'hello', T, 'c1', null);
  msg.run('m2', 's-c1', 'assistant', 'hi — ünïcode ✓', T + 1, 'c1', '{"turnId":"t1"}');
  msg.run('m3', 's-worker', 'assistant', 'worker says hi', T + 2, 'c-worker', null);
  for (let i = 0; i < 5; i++) msg.run(`ms${i}`, 's-stage', i % 2 ? 'assistant' : 'user', `stage ${i}`, T + 10 + i, null, '{"stageRunId":"sr-1"}');

  // Two definitions with the same name.
  const def = s.prepare(
    `INSERT INTO workflow_definitions (id, name, description, version, session_mode, harness_config, variables, tags, orchestrator_config, use_worktree, hooks, default_agent_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  def.run(
    'd1',
    'Review',
    'first',
    4,
    'single',
    JSON.stringify({ model: 'claude-sonnet', streaming: true, availableTools: ['*'], excludedTools: ['rm'] }),
    JSON.stringify([
      { name: 'topic', type: 'string', label: 'Topic', required: true },
      { name: 'item', type: 'git_url', label: 'Item', required: false },
      { name: 'repo_path_web', type: 'string', label: 'legacy path', required: false },
    ]),
    '["review"]',
    JSON.stringify({
      category: 'custom',
      requiresCodebase: true,
      codebaseAliases: ['web'],
      preprocessingSteps: [{ type: 'set_variable', name: 'Set', order: 0, failOnError: true, config: { type: 'set_variable', variableName: 'topic', value: '{{item}}' } }],
      postProcessingSteps: [],
      resultValidations: [{ stageIndex: 1, rules: [{ type: 'min_length', value: 10, message: 'too short' }] }],
      autoCommit: true,
      autoCreatePR: false,
    }),
    1,
    '[]',
    'global:reviewer',
    T,
    T + 5,
  );
  def.run('d2', 'Review', null, 1, 'auto', null, '[]', '[]', null, 1, '[]', null, T + 1, T + 1);

  const stage = s.prepare(
    `INSERT INTO stage_definitions (id, workflow_definition_id, name, "order", prompts, hooks, retry_policy, timeout_ms, condition, context_filter, context_sources, output_format, result_validation, expected_output, approval_required, agent_mode, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  stage.run('st-a', 'd1', 'Plan', 0, JSON.stringify([{ label: 'Go', text: 'Plan {{topic}} in {{repo_path_web}} on {{repo_branch_web}} for {{item}}' }]), '[]', '{"maxRetries":2,"backoffMs":500,"backoffMultiplier":2}', 90_000, null, 'summary-only', null, 'text', null, null, 0, 'interactive', T);
  stage.run('st-b', 'd1', 'Plan', 1, JSON.stringify([{ label: 'Again', text: 'Refine' }]), '[]', null, null, JSON.stringify({ type: 'expression', expression: 'variables.topic ~= 3' }), 'full', '["Plan"]', 'json', JSON.stringify([{ type: 'regex', value: '/^ok/i', message: 'must start ok' }, { type: 'llm_validation', value: 'good?', message: 'judge' }]), 'A verdict', 1, null, T);
  stage.run('st-c', 'd1', 'Build!', 2, JSON.stringify([{ label: 'B', text: 'Build' }]), '[]', null, null, JSON.stringify({ type: 'expression', expression: "status == 'completed' AND {{topic}} === 'x'" }), 'summary-only', null, 'text', null, null, 0, null, T);
  stage.run('st-d', 'd2', 'Only', 0, JSON.stringify([{ label: 'O', text: 'Only' }]), '[]', null, null, null, 'summary-only', null, 'text', null, null, 0, null, T);
  const edge = s.prepare(`INSERT INTO stage_edges (id, workflow_definition_id, from_stage_id, to_stage_id, edge_type) VALUES (?, ?, ?, ?, ?)`);
  edge.run('e1', 'd1', 'st-a', 'st-b', 'on_success');
  edge.run('e2', 'd1', 'st-b', 'st-c', 'on_completion');

  // One run with stage runs; one of them owns the stage session.
  s.prepare(`INSERT INTO workflow_runs (id, workflow_definition_id, name, status, created_at, updated_at) VALUES ('r1', 'd1', 'run', 'completed', ?, ?)`).run(T, T);
  const sr = s.prepare(`INSERT INTO stage_runs (id, workflow_run_id, stage_definition_id, session_id, name, status, created_at) VALUES (?, 'r1', ?, ?, ?, ?, ?)`);
  sr.run('sr-1', 'st-a', 's-stage', 'Plan', 'completed', T);
  sr.run('sr-2', 'st-b', null, 'Plan', 'sleeping', T);

  // Automations: single, loop, batch.
  const auto = s.prepare(
    `INSERT INTO automations (id, name, trigger_type, input_mode, loop_variable, loop_items, batch_data_format, batch_data, webhook_token, workflow_ids, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '["d1"]', ?, ?)`,
  );
  auto.run('a-single', 'Single', 'manual', 'single', null, '[]', null, null, 'tok-plain', T, T);
  auto.run('a-loop', 'Loop', 'schedule', 'loop', 'city', '["Oslo","Lima"]', null, null, null, T, T);
  auto.run('a-batch', 'Batch', 'manual', 'batch', null, '[]', 'csv', 'name,age\n"Ann, B",3\nBo,4\n', null, T, T);
  auto.run('a-script', 'Script', 'manual', 'script', null, '[]', null, null, null, T, T);
}

const CHAT_COLUMNS = {
  chats: ['id', 'name', 'description', 'session_id', 'model', 'tags', 'status', 'created_at', 'updated_at', 'harness_config', 'default_agent_mode', 'parent_chat_id', 'orchestrator_mode', 'source_control'],
  chat_messages: ['id', 'session_id', 'role', 'content', 'attachments', 'tool_name', 'tool_args', 'tool_result', 'timestamp', 'metadata', 'chat_id', 'agent_ref', 'agent_version'],
  sessions: ['id', 'name', 'description', 'status', 'model', 'repo_branch', 'tags', 'created_at', 'updated_at', 'conversation_id', 'owner_type', 'owner_id'],
};

/** Count + sha256 of the chat-owned rows over columns that survive v55. */
function chatHash(s: Database.Database) {
  const q = {
    chats: `SELECT ${CHAT_COLUMNS.chats.join(', ')} FROM chats ORDER BY id`,
    chat_messages: `SELECT ${CHAT_COLUMNS.chat_messages.join(', ')} FROM chat_messages WHERE session_id IN (SELECT session_id FROM chats) ORDER BY id`,
    sessions: `SELECT ${CHAT_COLUMNS.sessions.join(', ')} FROM sessions WHERE id IN (SELECT session_id FROM chats) ORDER BY id`,
  };
  return Object.fromEntries(
    Object.entries(q).map(([t, sql]) => {
      const rows = s.prepare(sql).all();
      return [t, { n: rows.length, hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }];
    }),
  );
}

function build(): { db: AppDatabase; s: Database.Database } {
  const db = createDB(':memory:');
  open.push(db);
  migrateDB(db, { targetVersion: 54 });
  const s = raw(db);
  seedV54(s);
  return { db, s };
}

describe('migration v55 workflow_definitions_v2', () => {
  it('keeps chats, their messages and sessions; drops exactly the run history', () => {
    const { db, s } = build();
    const before = chatHash(s);
    const messagesBefore = (s.prepare(`SELECT COUNT(*) AS n FROM chat_messages`).get() as { n: number }).n;

    migrateDB(db);

    expect((s.prepare(`SELECT MAX(version) AS v FROM _schema_versions`).get() as { v: number }).v).toBe(55);
    expect(chatHash(s)).toEqual(before);
    expect(before['chats']!.n).toBe(3);
    expect(before['chat_messages']!.n).toBe(3);
    // chat_messages shrank by exactly the stage session's five messages.
    expect((s.prepare(`SELECT COUNT(*) AS n FROM chat_messages`).get() as { n: number }).n).toBe(messagesBefore - 5);
    expect(s.prepare(`SELECT id FROM sessions ORDER BY id`).all()).toEqual([{ id: 's-c1' }, { id: 's-c2' }, { id: 's-worker' }]);
    expect(s.prepare(`SELECT COUNT(*) AS n FROM workflow_runs`).get()).toEqual({ n: 0 });
    expect(s.prepare(`SELECT COUNT(*) AS n FROM stage_runs`).get()).toEqual({ n: 0 });
    expect(s.pragma('foreign_key_check')).toEqual([]);
    // The legacy tables and columns are gone.
    for (const t of ['workflows', 'webhook_registrations', 'webhook_deliveries']) {
      expect(s.prepare(`SELECT 1 FROM sqlite_master WHERE name = ?`).get(t)).toBeUndefined();
    }
    const cols = (t: string) => (s.pragma(`table_info(${t})`) as Array<{ name: string }>).map((c) => c.name);
    expect(cols('chats')).not.toContain('copilot_config');
    expect(cols('sessions')).not.toContain('repo_url');
    expect(cols('chat_messages')).not.toContain('workflow_id');
    expect(cols('stage_runs')).toContain('stage_key');
    expect(cols('workflow_runs')).toContain('definition_version_id');
  });

  it('converts definitions to v2 documents with deterministic keys', () => {
    const run = () => {
      const { db, s } = build();
      migrateDB(db);
      return s;
    };
    const s = run();
    const keys = s.prepare(`SELECT key FROM stage_definitions WHERE workflow_definition_id = 'd1' ORDER BY ordinal`).all();
    expect(keys).toEqual([{ key: 'plan' }, { key: 'plan_2' }, { key: 'build' }]);
    expect(run().prepare(`SELECT id, key FROM stage_definitions ORDER BY id`).all()).toEqual(
      s.prepare(`SELECT id, key FROM stage_definitions ORDER BY id`).all(),
    );

    // Every stored spec parses with the FROZEN v2 schema.
    for (const row of s.prepare(`SELECT key, name, spec FROM stage_definitions`).all() as Array<{ key: string; name: string; spec: string }>) {
      expect(AgentStageSchema.safeParse({ ...JSON.parse(row.spec), key: row.key, name: row.name }).success).toBe(true);
    }
    for (const row of s.prepare(`SELECT name, description, project_id, spec FROM workflow_definitions`).all() as Array<Record<string, string | null>>) {
      const wf = { ...JSON.parse(row['spec']!), name: row['name'], ...(row['description'] ? { description: row['description'] } : {}) };
      expect(WorkflowSpecSchema.safeParse(wf).success).toBe(true);
    }
    const versions = s.prepare(`SELECT workflow_definition_id AS id, version, kind, spec FROM workflow_definition_versions ORDER BY id`).all() as Array<{ id: string; version: number; kind: string; spec: string }>;
    expect(versions.map((v) => [v.id, v.version, v.kind])).toEqual([['d1', 1, 'published'], ['d2', 1, 'published']]);
    const graph = WorkflowGraphSchema.parse(JSON.parse(versions[0]!.spec));

    const d1 = s.prepare(`SELECT status, revision, current_version_id, needs_attention FROM workflow_definitions WHERE id = 'd1'`).get() as Record<string, string>;
    expect(d1['status']).toBe('published');
    expect(d1['revision']).toBe(4);
    expect(d1['current_version_id']).toBeTruthy();

    const [plan, plan2, buildStage] = graph.stages;
    // Templates: codebase paths are typed; the reserved `item` variable was renamed.
    expect(plan!.prompts[0]!.text).toBe('Plan {{topic}} in {{run.codebases.web.path}} on {{run.codebases.web.branch}} for {{item_var}}');
    expect(graph.workflow.variables.map((v) => v.name)).toEqual(['topic', 'item_var']);
    expect(graph.workflow.lifecycle.preprocessingSteps[0]!.config).toEqual({ type: 'set_variable', variableName: 'topic', value: '{{item_var}}' });
    // retry / timeout / session / agent binding
    expect(plan!.retry).toMatchObject({ maxAttempts: 3, initialDelayMs: 500, backoffMultiplier: 2 });
    expect(plan!.timeouts).toEqual({ attemptMs: 90_000 });
    expect(plan!.session).toEqual({ defaultAgentMode: 'auto' });
    expect(graph.workflow.session).toEqual({ model: 'claude-sonnet', tools: { excluded: ['rm'] }, agentRef: 'global:reviewer' });
    // context by key, output contract, rules (index-matched workflow rule appended)
    expect(plan2!.context).toEqual({ mode: 'output', from: ['plan'] });
    expect(plan2!.output).toMatchObject({ format: 'json', instructions: 'A verdict' });
    expect(plan2!.output.rules).toEqual([
      { type: 'regex', pattern: '^ok', flags: 'i', message: 'must start ok' },
      { type: 'min_length', value: 10, message: 'too short' },
    ]);
    expect(plan2!.approval).toBeDefined();
    // The unparseable condition is kept literally and flagged.
    expect(plan2!.guard).toBe('variables.topic ~= 3');
    // A condition reading the parent status becomes the incoming edge's `when`.
    expect(buildStage!.guard).toBeUndefined();
    expect(graph.edges).toEqual([
      { from: 'plan', to: 'plan_2', on: 'success' },
      { from: 'plan_2', to: 'build', on: 'completion', when: "parent.status == 'completed' and variables.topic == 'x'" },
    ]);
    expect(graph.workflow.lifecycle).toMatchObject({ codebaseAliases: ['web'], requiresCodebase: true, postProcessing: { autoCommit: true } });

    const attention = JSON.parse(d1['needs_attention']!) as string[];
    expect(attention.some((n) => n.includes("variables.topic ~= 3") && n.includes('needs review'))).toBe(true);
    expect(attention.some((n) => n.includes('llm_validation'))).toBe(true);
    expect(attention.some((n) => n.includes("'item' renamed to 'item_var'"))).toBe(true);
    expect(s.prepare(`SELECT needs_attention FROM workflow_definitions WHERE id = 'd2'`).get()).toEqual({ needs_attention: null });
    expect(s.prepare(`SELECT COUNT(*) AS n FROM _migration_log WHERE entity = 'workflow_definition' AND entity_id = 'd1'`).get()).not.toEqual({ n: 0 });
  });

  it('converts or disables the legacy automation modes, and logs them', () => {
    const { db, s } = build();
    migrateDB(db);
    const row = (id: string) =>
      s.prepare(`SELECT enabled, data_schema, iteration_mode, default_dataset, webhook_token_hash FROM automations WHERE id = ?`).get(id) as Record<string, string | number | null>;

    expect(row('a-single')['data_schema']).toBeNull();
    expect(row('a-single')['webhook_token_hash']).toBe(createHash('sha256').update('tok-plain').digest('hex'));

    const loop = row('a-loop');
    expect(JSON.parse(loop['data_schema'] as string)).toEqual({ version: 1, format: 'json_array', fields: [{ name: 'city', type: 'string', required: true }] });
    expect(JSON.parse(loop['iteration_mode'] as string)).toEqual({ kind: 'each_row' });
    expect(JSON.parse(JSON.parse(loop['default_dataset'] as string).data)).toEqual([{ city: 'Oslo' }, { city: 'Lima' }]);

    const batch = row('a-batch');
    expect(JSON.parse(JSON.parse(batch['default_dataset'] as string).data)).toEqual([{ name: 'Ann, B', age: '3' }, { name: 'Bo', age: '4' }]);

    expect(row('a-script')['enabled']).toBe(0);
    const logged = s.prepare(`SELECT entity_id, message FROM _migration_log WHERE entity = 'automation' ORDER BY entity_id, id`).all() as Array<{ entity_id: string; message: string }>;
    expect(logged.map((l) => l.entity_id)).toEqual(expect.arrayContaining(['a-batch', 'a-loop', 'a-script', 'a-single']));
    expect(logged.find((l) => l.entity_id === 'a-script')!.message).toMatch(/^disabled:/);
  });
});
