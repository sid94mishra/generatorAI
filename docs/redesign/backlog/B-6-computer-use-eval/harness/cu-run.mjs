// node cu-run.mjs <scenario> <model> <harnessType> <label> — one computer-use task, driven like a user:
// a new chat with that model, the task typed in the composer, consent cards answered "Allow for this chat",
// tool-approval cards "Allow once", then metrics from the transcript and the computer-use audit.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const require = createRequire('/Users/sidmishra/Desktop/Projects/generatorAI/agent-tests/package.json');
const { chromium } = require('playwright');

const DIR = path.dirname(new URL(import.meta.url).pathname);
const DB = '/Users/sidmishra/Library/Application Support/@generatorai/desktop/data/generatorai.db';
const [scenario, model, harnessType, label] = process.argv.slice(2);
const prompt = JSON.parse(fs.readFileSync(path.join(DIR, 'scenarios.json'), 'utf8'))[scenario];
const outDir = path.join(DIR, 'results');
fs.mkdirSync(outDir, { recursive: true });
const runId = `${label}-${scenario}`;
const logFile = path.join(outDir, `${runId}.log`);
fs.writeFileSync(logFile, '');
const log = (...a) => fs.appendFileSync(logFile, `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}\n`);
const rows = (q) => { const t = execFileSync('sqlite3', ['-readonly', '-json', DB, q], { encoding: 'utf8' }).trim(); return t ? JSON.parse(t) : []; };

const browser = await chromium.connectOverCDP('http://127.0.0.1:9555');
const win = browser.contexts().flatMap((c) => c.pages()).find((p) => /^http:\/\/127\.0\.0\.1/.test(p.url()));
const api = (method, p, body) => win.evaluate(async ({ method, p, body }) => {
  const r = await fetch(location.origin + p, { method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  try { return { status: r.status, json: JSON.parse(text) }; } catch { return { status: r.status, text }; }
}, { method, p, body });

const created = await api('POST', '/api/chats', { name: `CU ${runId}`, model, harnessConfig: { harnessType } });
const chat = created.json?.chat ?? created.json;
log('chat', chat.id, model, harnessType);
for (let i = 0; i < 3; i++) await win.keyboard.press('Escape');
await win.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); }, `/chats/${chat.id}`);
await win.waitForTimeout(3000);

const box = win.locator('[data-testid=chat-workspace]').getByRole('textbox', { name: 'Message' }).last();
await box.click(); await box.fill(prompt); await win.waitForTimeout(300);
const t0 = Date.now();
await box.press('Enter');
log('sent:', prompt);
await win.waitForTimeout(5000);

const busy = () => win.evaluate(() => !!document.querySelector('[data-testid="thinking-placeholder"], [role="status"][aria-label="Generating"], [data-gai-live]')).catch(() => true);
const assistants = () => rows(`select count(*) n from chat_messages where chat_id='${chat.id}' and role='assistant'`)[0].n;
let consents = 0, approvals = 0, questions = 0, idleSince = 0;
const LIMIT = 30 * 60_000;
while (Date.now() - t0 < LIMIT) {
  const card = win.getByTestId('computer-consent-card').last();
  if (await card.count().catch(() => 0)) {
    const text = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    const allow = card.getByRole('button', { name: /Allow this run|Allow for this chat/ });
    const once = card.getByRole('button', { name: /^Allow once/ });
    if (await allow.count()) await allow.first().click(); else if (await once.count()) await once.first().click();
    consents++; log('consent answered:', text);
    await win.waitForTimeout(1500);
    continue;
  }
  const perm = win.getByRole('button', { name: /^Allow once/ });
  if (await perm.count().catch(() => 0)) {
    const cmd = (await win.locator('pre, code').last().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    if (/osascript|AppleScript|cua-driver|rm -rf|git push/.test(cmd)) { log('!! NOT approving tool call:', cmd); await win.getByRole('button', { name: /^Deny/ }).first().click().catch(() => {}); }
    else { await perm.first().click(); log('tool approved once:', cmd); }
    approvals++;
    await win.waitForTimeout(1500);
    continue;
  }
  if (await win.getByTestId('question-card').count().catch(() => 0)) { questions++; if (questions === 1) log('!! the agent asked a question'); }
  if (!(await busy()) && assistants() > 0) { idleSince ||= Date.now(); if (Date.now() - idleSince > 8000) break; } else idleSince = 0;
  await win.waitForTimeout(2500);
}
const seconds = Math.round((Date.now() - t0) / 1000);
const last = rows(`select content, metadata from chat_messages where chat_id='${chat.id}' and role='assistant' order by rowid desc limit 1`)[0] ?? {};
const meta = last.metadata ? JSON.parse(last.metadata) : {};
const calls = meta.toolCalls ?? [];
const failedCall = (t) => t.success === false || /"ok"\s*:\s*false|\\"ok\\":false|refus/i.test(JSON.stringify(t.result ?? '').slice(0, 4000));
const audit = rows(`select action, app_label, verified, refusal_code, path, target, created_at from computer_use_audit where chat_id='${chat.id}' order by created_at`);
let tokens = null;
try { tokens = JSON.parse(execFileSync('python3', ['-I', path.join(DIR, 'usage.py'), chat.id], { encoding: 'utf8' })); } catch {}
const result = {
  runId, scenario, model, harnessType, chatId: chat.id, workspaceId: chat.workspaceId, seconds, tokens,
  timedOut: seconds * 1000 >= LIMIT, partial: !!meta.partial,
  toolCalls: calls.length,
  computerCalls: calls.filter((t) => t.tool.startsWith('computer_') || /computer_/.test(t.tool)).length,
  failedCalls: calls.filter(failedCall).length,
  byTool: calls.reduce((m, t) => ((m[t.tool] = (m[t.tool] ?? 0) + 1), m), {}),
  audit: { actions: audit.length, verified: audit.filter((a) => a.verified).length, refusals: audit.filter((a) => a.refusal_code).map((a) => `${a.action}:${a.refusal_code}`) },
  consents, approvals, questions,
  usage: meta.usage ?? null,
  reply: last.content ?? '',
};
fs.writeFileSync(path.join(outDir, `${runId}.json`), JSON.stringify({ ...result, calls: calls.map((t) => ({ tool: t.tool, args: t.args, success: t.success, result: JSON.stringify(t.result ?? '').slice(0, 600) })), auditRows: audit }, null, 1));
log(`done in ${seconds}s | tools ${result.toolCalls} (computer ${result.computerCalls}, failed ${result.failedCalls}) | audit ${result.audit.actions} actions, ${result.audit.verified} verified, refusals ${result.audit.refusals.length} | consents ${consents} approvals ${approvals}`);
log('reply:', result.reply);
console.log(JSON.stringify({ runId, seconds, tokens: tokens?.context_total, out: tokens?.output, tools: result.toolCalls, computer: result.computerCalls, failed: result.failedCalls, refusals: result.audit.refusals.length, consents }));
await browser.close().catch(() => {});
