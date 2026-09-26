// Pair the E2E device once (P00 WP-0.3). run.mjs calls this BEFORE any
// scenario so scenarios never pair concurrently (a new recovery grant revokes
// the outstanding one). Uses the CREDS file from the environment.
import { api, ensurePaired, runtime } from './lib/client.mts';

await ensurePaired();
const r = await api('GET', '/workflow-definitions');
console.log(JSON.stringify({ state: runtime.currentState?.status ?? 'authenticated', definitions: r.status }));
process.exit(r.status === 200 ? 0 : 1);
