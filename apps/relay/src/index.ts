// ────────────────────────────────────────────────────────────────
// GeneratorAI relay — self-hostable director + cell.
//
// Run one of these anywhere a GeneratorAI server and a phone can both reach
// (a $5 VPS is plenty). The GeneratorAI server dials OUT to it, so no inbound
// firewall rule is ever needed on the machine that holds your code.
//
//   GET  /relay/assignment?relayHostId=…  → which cell to use (director)
//   WS   /relay/host                      → host control channel
//   WS   /relay/client                    → client connection
//   WS   /relay/data?streamId=…           → per-stream byte pipe
//   GET  /healthz                         → liveness + capacity
//
// Deliberately minimal: this process must be boring, auditable and safe to
// operate without seeing user data. Everything it forwards is already sealed
// end-to-end by the client and the host.
//
// Environment:
//   PORT                          listen port (default 8787)
//   GENERATORAI_RELAY_ORIGIN      public origin, e.g. wss://relay.example.com
//   GENERATORAI_RELAY_MAX_HOSTS   capacity ceiling (default 500)
// ────────────────────────────────────────────────────────────────

import express from 'express';
import { createServer } from 'node:http';
import { RELAY_PROTOCOL_VERSION } from '@generatorai/relay-protocol';
import { RelayCell } from './cell.js';

const port = Number(process.env['PORT'] ?? 8787);
const origin =
  process.env['GENERATORAI_RELAY_ORIGIN'] ?? `ws://127.0.0.1:${port}`;

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

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

const cell = new RelayCell({ origin, log });

/**
 * Director endpoint.
 *
 * A single-process deployment always assigns the caller to its own cell. The
 * response shape is the multi-cell one so a fleet deployment can grow into it
 * without a protocol change.
 */
app.get('/relay/assignment', (req, res) => {
  const relayHostId = String(req.query['relayHostId'] ?? '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(relayHostId)) {
    res.status(400).json({
      error: { code: 'INVALID_HOST_ID', message: 'relayHostId must be a 43-char base64url id.' },
    });
    return;
  }
  const httpOrigin = origin.replace(/^ws/, 'http');
  res.json({
    v: RELAY_PROTOCOL_VERSION,
    relayHostId,
    cellUrl: `${origin}/relay/host`,
    directorUrl: `${httpOrigin}/relay/assignment`,
    assignmentEpoch: 1,
    // Hosts re-register well before this; a short lease means a decommissioned
    // cell drains quickly instead of black-holing traffic.
    expiresAt: Date.now() + 60 * 60_000,
  });
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, v: RELAY_PROTOCOL_VERSION, ...cell.stats() });
});

const server = createServer(app);
cell.attach(server);

server.listen(port, () => {
  log('info', 'GeneratorAI relay listening', { port, origin });
  log(
    'info',
    'This relay is a blind forwarder: it cannot decrypt application traffic. ' +
      'It can observe connection metadata and deny service.',
  );
});

function shutdown(signal: string): void {
  log('info', 'Shutting down', { signal });
  cell.close();
  server.close(() => process.exit(0));
  // Never hang a container restart on a stuck socket.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
