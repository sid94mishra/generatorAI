// ────────────────────────────────────────────────────────────────
// GeneratorAI relay — self-hostable director + cell.
//
// Run one of these anywhere a GeneratorAI server and a phone can both reach
// (a $5 VPS is plenty). The GeneratorAI server dials OUT to it, so no inbound
// firewall rule is ever needed on the machine that holds your code.
//
// Routes (paths come from `RELAY_ROUTES` in @generatorai/relay-protocol —
// the host connector imports the same table, so the two cannot drift):
//   GET  /relay/assignment?relayHostId=…  → which cell to use (director)
//   WS   /relay/host                      → host control channel
//   WS   /relay/client                    → client connection
//   WS   /relay/data?streamId=…           → per-stream byte pipe
//   GET  /healthz                         → liveness + capacity
//
// Deliberately minimal: this process must be boring, auditable and safe to
// operate. It never receives a device credential, token or scope. It does,
// however, SEE the application bytes it forwards: the E2EE layer in
// `packages/relay-protocol/src/e2ee.ts` is not wired into any transport yet,
// so whoever operates a relay can read the HTTP traffic passing through it
// unless the hop is otherwise protected. Run it over TLS and treat the
// operator as trusted until that changes.
//
// Environment:
//   PORT                          listen port (default 8787)
//   GENERATORAI_RELAY_ORIGIN      public origin, e.g. https://relay.example.com
//                                 (ws/wss accepted; normalised to http/https)
//   GENERATORAI_RELAY_MAX_HOSTS   capacity ceiling (default 500)
// ────────────────────────────────────────────────────────────────

import { createServer } from 'node:http';
import { createRelayApp } from './app.js';

const port = Number(process.env['PORT'] ?? 8787);
const configuredOrigin = process.env['GENERATORAI_RELAY_ORIGIN'] ?? `http://127.0.0.1:${port}`;

function log(level: 'info' | 'warn' | 'error', message: string, meta?: unknown): void {
  // Structured, single-line, and deliberately free of any credential field:
  // the cell never has a token worth logging, and we keep it that way.
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {}),
  });
  process.stdout.write(`${line}\n`);
}

const relay = createRelayApp({ origin: configuredOrigin, log });
const server = createServer(relay.app);
relay.attach(server);

server.listen(port, () => {
  log('info', 'GeneratorAI relay listening', { port, origin: relay.origin });
  log(
    'warn',
    'This relay forwards application bytes it can read: end-to-end encryption is ' +
      'not wired into the relay data path yet. It never receives device credentials ' +
      'or tokens, but it can observe traffic, connection metadata, and deny service.',
  );
});

function shutdown(signal: string): void {
  log('info', 'Shutting down', { signal });
  relay.cell.close();
  server.close(() => process.exit(0));
  // Never hang a container restart on a stuck socket.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
