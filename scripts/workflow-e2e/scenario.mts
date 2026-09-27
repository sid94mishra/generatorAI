// ────────────────────────────────────────────────────────────────
// Run ONE E2E scenario against the isolated server (P00 WP-0.3).
//
//   tsx scripts/workflow-e2e/scenario.mts --spec specs/t2.json --provider claude-agent --out <file>
//
// A spec is `{tag, description, timeoutMs, variables?, graph}` where
// `graph` is a v2 workflow document (formatVersion 2). The runner creates
// the definition from the whole graph and publishes it, starts the run
// through THE invocation (`--provider` other than faux becomes the run's
// `overrides.harnessType`, with E2E_MODEL or the catalog's haiku),
// captures the run-scope SSE stream, polls to a terminal (or paused)
// status, then snapshots the stage rows from the API and the stage
// transcripts from the DB (read-only). Writes the result JSON to --out. Expectations are evaluated by run.mjs, not here, so
// a result can be re-judged offline.
// ────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { api, createWorkflow, ensurePaired, invokeRun, sleep, subscribeRun, waitRun } from './lib/client.mts';
import { openDb } from './lib/db.mjs';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const specFile = arg('spec');
const outFile = arg('out');
const provider = arg('provider') ?? 'claude-agent';
if (!specFile || !outFile) {
  console.error('usage: scenario.mts --spec <file> --out <file> [--provider claude-agent|faux]');
  process.exit(2);
}

const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
if (spec.graph?.formatVersion !== 2) throw new Error(`${specFile}: \`graph\` must be a v2 workflow document (formatVersion 2)`);

/** The model a live run uses: E2E_MODEL, else the provider catalog's first haiku, else the provider default. */
async function liveModel(): Promise<string | undefined> {
  if (process.env.E2E_MODEL) return process.env.E2E_MODEL;
  const r = await api('GET', `/harness/models?provider=${encodeURIComponent(provider)}`);
  const ids: string[] = Array.isArray(r.body) ? r.body.map((m: { id: string }) => m.id) : [];
  return ids.find((id) => /haiku/i.test(id));
}

await ensurePaired();
let overrides: Record<string, unknown> | undefined;
if (provider !== 'faux') {
  const model = await liveModel();
  overrides = { harnessType: provider, ...(model ? { model } : {}) };
}
const t0 = Date.now();
const wf = await createWorkflow(spec.graph);
const runId = await invokeRun(wf.id, spec.variables ?? {}, overrides);
const sub = await subscribeRun(runId);
const timeline: string[] = [];
const seen = new Map<string, string>();
const res = await waitRun(runId, spec.timeoutMs ?? 900_000, 1000, (_run, stages) => {
  for (const s of stages) {
    const k = `${s.status}/${s.currentAttempt}`;
    if (seen.get(s.name) !== k) {
      seen.set(s.name, k);
      timeline.push(`${Date.now() - t0}ms ${s.name}=${k}`);
    }
  }
});
await sleep(1500);
await sub.stop();

const stagesBody = (await api('GET', `/workflow-runs/${runId}/stages`)).body;
const stageRows: any[] = stagesBody?.data ?? stagesBody ?? [];

// Stage transcripts, read-only from the isolated DB: each attempt's
// conversation. Predecessor context is fenced into the first prompt (P03),
// so a user message carrying the fence is flagged `isContextMessage`.
const CONTEXT_FENCE = '<generatorai:stage-context';
const messages: Record<string, Array<{ role: string; content: string; flags: string[] }>> = {};
const db = openDb();
try {
  const rows = db
    .prepare(
      `SELECT sr.name AS stage, m.role, m.content FROM chat_messages m
         JOIN stage_attempts a ON a.session_id = m.session_id
         JOIN stage_runs sr ON sr.id = a.stage_run_id
        WHERE sr.workflow_run_id = ? ORDER BY m.timestamp, m.rowid`,
    )
    .all(runId) as Array<{ stage: string; role: string; content: string }>;
  for (const r of rows) {
    const flags = r.role === 'user' && r.content.includes(CONTEXT_FENCE) ? ['isContextMessage'] : [];
    (messages[r.stage] ??= []).push({ role: r.role, content: r.content.slice(0, 20_000), flags });
  }
} finally {
  db.close();
}

const kinds = (e: any) => e.json?.kind ?? e.event ?? '';
// Stream frames carry the event body under `payload` (older frames: `data`).
const body = (e: any) => e.json?.payload ?? e.json?.data ?? {};
const result = {
  tag: spec.tag,
  provider,
  defId: wf.id,
  runId,
  runStatus: res.run?.status,
  runError: res.run?.error,
  wallMs: Date.now() - t0,
  timeline,
  stages: stageRows.map((s) => ({
    name: s.name,
    key: s.stageKey,
    kind: s.kind,
    status: s.status,
    attempts: s.currentAttempt,
    error: s.error ?? undefined,
    output: s.kind === 'agent' ? undefined : s.outputData,
    outputText: typeof s.outputText === 'string' ? s.outputText.slice(0, 600) : undefined,
    summary: typeof s.summary === 'string' ? s.summary.slice(0, 300) : undefined,
  })),
  messages,
  sse: {
    count: sub.events.length,
    errors: sub.events.filter((e) => e.error).map((e) => e.error),
    lifecycle: sub.events
      .filter((e) => /^(stage_run|workflow_run)\./.test(kinds(e)))
      .map((e) => `${e.rel} ${kinds(e)} ${body(e).name ?? ''}`.trim()),
    sessionInfo: sub.events
      .filter((e) => kinds(e) === 'harness.session_info')
      .map((e) => ({
        infoType: body(e).infoType,
        message: String(body(e).message ?? '').slice(0, 200),
      })),
  },
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    tag: result.tag,
    runStatus: result.runStatus,
    wallMs: result.wallMs,
    stages: result.stages.map((s) => `${s.name}:${s.status}:a${s.attempts}`),
  }),
);
process.exit(0);
