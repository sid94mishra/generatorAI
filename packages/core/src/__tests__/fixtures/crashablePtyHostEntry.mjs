/**
 * Test fixture — a pty-host entry point that speaks the real IPC protocol but
 * owns no PTYs, and can be made to die on command.
 *
 * The real `apps/pty-host` cannot be used for the host-crash tests: killing it
 * means reaching for its pid through two layers of private state, and the
 * restart-cap test needs it to die five times in a row on cue. Everything
 * about the crash path under test — synthesised exits, the restart budget,
 * the fatal latch — lives in `PtyHostClient`, not in the host, so a host that
 * only implements the wire protocol exercises exactly the code in question.
 *
 * Plain `.mjs` on purpose: no workspace imports, so it boots under bare `node`
 * with or without a TypeScript loader.
 */

const sessions = new Set();

/** Written by a `write` request whose data is this marker. */
const CRASH_MARKER = '__CRASH__';

process.on('message', (req) => {
  if (!req || typeof req !== 'object') return;
  const { type, reqId, sessionId } = req;

  switch (type) {
    case 'ping':
      process.send({ type: 'pong', reqId });
      return;

    case 'create_session':
      sessions.add(sessionId);
      process.send({ type: 'session_ready', sessionId, pid: process.pid });
      process.send({ type: 'ack', reqId, ok: true });
      return;

    case 'write':
      if (req.data === CRASH_MARKER) {
        // No ack — the client must cope with a host that dies mid-request.
        process.exit(7);
      }
      process.send({ type: 'ack', reqId, ok: true });
      return;

    case 'ack':
      // Echo the credit back as a data notification so a test can observe that
      // `PtyHostClient.ack()` actually reached the host.
      process.send({ type: 'data', sessionId, chunk: `CREDIT:${req.bytesConsumed}` });
      process.send({ type: 'ack', reqId, ok: true });
      return;

    case 'destroy':
      sessions.delete(sessionId);
      process.send({ type: 'ack', reqId, ok: true });
      return;

    default:
      process.send({ type: 'ack', reqId, ok: true });
  }
});

process.send({ type: 'pong', reqId: '__ready__' });
