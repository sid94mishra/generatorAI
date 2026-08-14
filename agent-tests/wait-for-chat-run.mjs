// Blocks until the chat's run finishes (or times out), printing computer-use
// audit progress so the wait is legible.
import Database from 'better-sqlite3';

const chatId = process.argv[2];
const timeoutMs = Number(process.argv[3] ?? 900) * 1000;
const started = Date.now();
let lastCount = -1;

const db = new Database('packages/db/data/generatorai.db', { readonly: true });
const countStmt = db.prepare('SELECT COUNT(*) AS n FROM computer_use_audit WHERE chat_id = ?');
const lastStmt = db.prepare(
  'SELECT action, app_label, target, refusal_code, verified FROM computer_use_audit WHERE chat_id = ? ORDER BY id DESC LIMIT 1',
);

while (Date.now() - started < timeoutMs) {
  let running = true;
  try {
    const health = await (await fetch('http://127.0.0.1:3100/api/health')).json();
    running = (health.runningChatIds ?? []).includes(chatId);
  } catch {
    // Server blip; assume still running.
  }
  const { n } = countStmt.get(chatId);
  if (n !== lastCount) {
    const last = lastStmt.get(chatId);
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(
      `[${String(secs).padStart(4)}s] steps=${n}` +
        (last ? `  last=${last.action} ${last.app_label ?? '-'} ${last.target ?? ''}` +
          `${last.refusal_code ? ` REFUSED=${last.refusal_code}` : ''}${last.verified ? ' verified' : ''}` : ''),
    );
    lastCount = n;
  }
  if (!running && n > 0) {
    console.log(`\nrun finished after ${Math.round((Date.now() - started) / 1000)}s with ${n} computer steps`);
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}
db.close();
