// Answers Computer Use consent prompts the way the panel's buttons do, then
// checks the grant it created is listed and revocable.
//
//   node agent-tests/computer-use-consent-e2e.mjs <workspaceId>

const base = 'http://127.0.0.1:3100';
const workspaceId = process.argv[2];
if (!workspaceId) {
  console.error('usage: node agent-tests/computer-use-consent-e2e.mjs <workspaceId>');
  process.exit(2);
}

let failures = 0;
function check(name, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures += 1;
}

const api = async (path, init) => {
  const res = await fetch(`${base}/api/workspaces/${workspaceId}/computer${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

async function waitForPending(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await api('/consent');
    const first = body?.pending?.[0];
    if (first) return first;
    await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}

const prompt = await waitForPending();
if (!prompt) {
  console.log('SKIP  no consent prompt appeared — is a computer-use turn running?');
  process.exit(0);
}
console.log(`prompt: ${prompt.action} on ${prompt.appLabel} (${prompt.path})`);

// An answer that names the wrong application must not be accepted, even with a
// valid requestId — that is the whole point of carrying appIdentity.
const spoofed = await api('/consent', {
  method: 'POST',
  body: JSON.stringify({
    requestId: prompt.requestId,
    appIdentity: 'com.example.not-the-app',
    decision: 'always_allow',
  }),
});
check('an answer naming the wrong app is rejected', spoofed.status === 409, `status=${spoofed.status}`);

const answered = await api('/consent', {
  method: 'POST',
  body: JSON.stringify({
    requestId: prompt.requestId,
    appIdentity: prompt.appIdentity,
    decision: 'always_allow',
  }),
});
check('the real answer is accepted', answered.status === 200, `status=${answered.status}`);

const replay = await api('/consent', {
  method: 'POST',
  body: JSON.stringify({
    requestId: prompt.requestId,
    appIdentity: prompt.appIdentity,
    decision: 'always_allow',
  }),
});
check('replaying the same answer is rejected', replay.status === 409, `status=${replay.status}`);

const { body: grantsBody } = await api('/grants');
const grant = (grantsBody?.grants ?? []).find((g) => g.appIdentity === prompt.appIdentity);
// Synthetic prompts are downgraded to allow_once and deliberately never persist.
if (prompt.path === 'synthetic') {
  check('synthetic consent did NOT create a standing grant', !grant);
} else {
  check('always_allow created a standing grant', !!grant, grant ? `${grant.appLabel} (${grant.scope})` : 'missing');

  const revoked = await api(`/grants/${encodeURIComponent(prompt.appIdentity)}`, { method: 'DELETE' });
  check('the grant can be revoked', revoked.status === 200, `status=${revoked.status}`);

  const { body: after } = await api('/grants');
  check(
    'the revoked grant is gone',
    !(after?.grants ?? []).some((g) => g.appIdentity === prompt.appIdentity),
  );
}

console.log(failures === 0 ? '\nConsent E2E: all checks passed.' : `\nConsent E2E: ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
