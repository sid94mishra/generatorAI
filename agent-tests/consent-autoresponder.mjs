// Stands in for a human watching the consent card: approves every prompt for
// the run, logging what was asked so the trace shows which gates were hit.
const base = 'http://127.0.0.1:3100';
const workspaceId = process.argv[2];
const seconds = Number(process.argv[3] ?? 300);

const deadline = Date.now() + seconds * 1000;
const seen = new Set();

while (Date.now() < deadline) {
  try {
    const res = await fetch(`${base}/api/workspaces/${workspaceId}/computer/consent`);
    const body = await res.json();
    for (const p of body.pending ?? []) {
      if (seen.has(p.requestId)) continue;
      seen.add(p.requestId);
      const answer = await fetch(`${base}/api/workspaces/${workspaceId}/computer/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: p.requestId,
          appIdentity: p.appIdentity,
          decision: 'always_allow',
        }),
      });
      console.log(`[consent] ${p.action} on ${p.appLabel} (${p.path}) -> ${answer.status}`);
    }
  } catch {
    // Server restarting; keep watching.
  }
  await new Promise((r) => setTimeout(r, 500));
}
console.log(`[consent] watcher done, answered ${seen.size}`);
