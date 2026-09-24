// Read-only, WAL-safe inspector for the isolated E2E database (P00 WP-0.3).
// better-sqlite3 is resolved from packages/db and opened with
// `readonly: true`, so it can run while the server writes.
//   node scripts/workflow-e2e/lib/db.mjs "SELECT ..." [params...]
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(path.join(REPO, 'packages', 'db', 'package.json'));
const Database = require('better-sqlite3');

export const DB_PATH = process.env.E2E_DB_PATH ?? 'C:/gaiwf/data/data.db';

export function openDb(dbPath = DB_PATH) {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2]) {
  const db = openDb();
  try {
    console.log(JSON.stringify(db.prepare(process.argv[2]).all(...process.argv.slice(3)), null, 1));
  } finally {
    db.close();
  }
}
