// ────────────────────────────────────────────────────────────────
// Run ONE E2E scenario against the isolated server (P00 WP-0.3).
//
//   tsx scripts/workflow-e2e/scenario.mts --spec specs/t2.json --provider claude-agent --out <file>
//
// Generic runner ported from C:/gaimob/wfe2e/runwf.mts: creates the
// definition through the REST API (definition → stages → edges), creates and
// starts the run, captures the run-scope SSE stream, polls to a terminal
// status, then snapshots the run from the API and the stage transcripts from
// the DB (read-only). Writes the result JSON to --out. Expectations are
// evaluated by run.mjs, not here, so a result can be re-judged offline.
// ────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { api, createRun, createWorkflow, ensurePaired, sleep, subscribeRun, waitRun } from './lib/client.mts';
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
const def = { ...spec.def };
if (provider !== 'faux') {
  def.harnessConfig = { model: 'haiku', harnessType: provider, ...(def.harnessConfig ?? {}) };
}

await ensurePaired();
const t0 = Date.now();
const wf = await createWorkflow(def, spec.stages, spec.edges ?? []);
const runId = await createRun(wf.id, spec.variables ?? {});
const sub = await subscribeRun(runId);
await sleep(300);
const start = await api('POST', `/workflow-runs/${runId}/start`);
const timeline: string[] = [];
const seen = new Map<string, string>();
const res = await waitRun(runId, spec.timeoutMs ?? 900_000, 1000, (_run, stages) => {
  for (const s of stages) {
    const k = `${s.status}/${s.retryCount}`;
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

// Stage transcripts, read-only from the isolated DB.
const messages: Record<string, Array<{ role: string; content: string; flags: string[] }>> = {};
const db = openDb();
try {
  const rows = db
    .prepare(
      `SELECT sr.name AS stage, m.role, m.content, m.metadata FROM chat_messages m
         JOIN stage_runs sr ON sr.id = json_extract(m.metadata, '$.stageRunId')
        WHERE sr.workflow_run_id = ? ORDER BY m.timestamp, m.rowid`,
    )
    .all(runId) as Array<{ stage: string; role: string; content: string; metadata: string | null }>;
  for (const r of rows) {
    const meta = r.metadata ? JSON.parse(r.metadata) : {};
    const flags = Object.keys(meta).filter((k) => k.startsWith('is') && meta[k] === true);
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
  startStatus: start.status,
  runStatus: res.run?.status,
  runError: res.run?.error,
  sessionMode: res.run?.sessionMode,
  wallMs: Date.now() - t0,
  timeline,
  stages: stageRows.map((s) => ({
    name: s.name,
    status: s.status,
    retryCount: s.retryCount,
    error: s.error ?? undefined,
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
    stages: result.stages.map((s) => `${s.name}:${s.status}:r${s.retryCount}`),
  }),
);
process.exit(0);
