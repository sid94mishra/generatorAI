// Reads a chat's computer-use audit as an ordered path, and flags the two
// failure shapes that matter: the same call repeated against the same target,
// and refusals retried without anything changing in between.
import Database from 'better-sqlite3';

const chatId = process.argv[2];
const db = new Database('packages/db/data/generatorai.db', { readonly: true });
const rows = db
  .prepare('SELECT * FROM computer_use_audit WHERE chat_id = ? ORDER BY id')
  .all(chatId);

console.log(`steps=${rows.length}\n`);

const counts = new Map();
let repeats = 0;
let prevKey = null;
let consecutive = 1;

rows.forEach((r, i) => {
  const key = `${r.action}|${r.app_label}|${r.target ?? ''}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
  if (key === prevKey) {
    consecutive += 1;
    if (consecutive >= 3) repeats += 1;
  } else {
    consecutive = 1;
  }
  prevKey = key;

  const flags = [
    r.refusal_code ? `REFUSED=${r.refusal_code}` : null,
    r.verified ? null : 'unverified',
    r.path === 'synthetic' ? 'TOOK-SCREEN' : null,
  ].filter(Boolean);
  console.log(
    `${String(i + 1).padStart(3)}. ${String(r.action).padEnd(15)} ${String(r.app_label ?? '-').padEnd(14)}` +
      ` ${String(r.target ?? '').padEnd(22)} ${flags.join(' ')}`,
  );
});

console.log('\n── repeated calls (same action+app+target) ──');
const dupes = [...counts].filter(([, n]) => n > 2).sort((a, b) => b[1] - a[1]);
if (dupes.length === 0) console.log('  none above 2');
for (const [key, n] of dupes) console.log(`  ${n}×  ${key}`);

const refusals = rows.filter((r) => r.refusal_code);
console.log(`\nrefusals: ${refusals.length}`);
for (const r of refusals) console.log(`  ${r.action} ${r.app_label} → ${r.refusal_code}`);
console.log(`runs of 3+ identical consecutive calls: ${repeats}`);
console.log(`screen takeovers: ${rows.filter((r) => r.path === 'synthetic').length}`);

db.close();
