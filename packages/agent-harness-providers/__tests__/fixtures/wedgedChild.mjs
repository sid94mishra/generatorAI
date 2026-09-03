#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// wedgedChild.mjs — W13 fixture for the overall fan-out timeout.
//
// A REAL child process that accepts requests and never answers them. This is
// the exact failure the plan describes:
//
//   "the transport awaits an unbounded deferred per request, so a wedged child
//    would block the parent interrupt forever — exactly during the runaway
//    fleet where Stop matters most."
//
// Mocking it with `new Promise(() => {})` would prove only that a never-
// settling promise never settles. Spawning a process proves the parent's
// overall deadline holds against a child that is genuinely alive, holding an
// open pipe, and returning nothing — including that the parent returns WITHOUT
// killing it, which is the co-tenant rule from `semanticCancel.ts`.
//
// Protocol (newline-delimited JSON on stdin/stdout):
//   {"id": N, "wedge": true}   → acknowledged on stderr, never answered
//   {"id": N, "wedge": false}  → {"id": N, "ok": true} on stdout
//   {"cmd": "ping"}            → {"pong": true}
// ────────────────────────────────────────────────────────────────

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.cmd === 'ping') {
      process.stdout.write(`${JSON.stringify({ pong: true })}\n`);
      continue;
    }
    if (msg.wedge) {
      // Deliberately no reply, ever. Announce on stderr so the test can prove
      // the request really did reach the child before it was abandoned.
      process.stderr.write(`wedged ${msg.id}\n`);
      continue;
    }
    process.stdout.write(`${JSON.stringify({ id: msg.id, ok: true })}\n`);
  }
});

// Keep the process alive with no work to do, exactly like a runtime that has
// stopped draining its own queue.
setInterval(() => {}, 1 << 30);
