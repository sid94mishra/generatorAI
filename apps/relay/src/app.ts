// ────────────────────────────────────────────────────────────────
// createRelayApp — the director + cell as a constructible unit.
//
// Split out of `index.ts` so the end-to-end test can boot the REAL relay on
// an ephemeral port in-process and connect the REAL host connector to it.
// `index.ts` is now just "read env, listen, log".
// ────────────────────────────────────────────────────────────────

import express from 'express';
import type { Server } from 'node:http';
import {
  RELAY_PROTOCOL_VERSION,
  RELAY_ROUTES,
  canonicalRelayOrigin,
  type RelayAssignment,
} from '@generatorai/relay-protocol';
import { RelayCell, type CellOptions } from './cell.js';

export interface RelayAppOptions {
  /**
   * Public origin hosts and clients dial. Any scheme (`ws`, `wss`, `http`,
   * `https`) is accepted and normalised to its canonical http(s) origin — the
   * form that appears in assignments, pairing offers and the host-proof
   * transcript, so every peer signs the same string.
   */
  origin: string;
  log: CellOptions['log'];
}

export interface RelayApp {
  app: express.Express;
  cell: RelayCell;
  /** The canonical http(s) origin the assignment advertises. */
  origin: string;
  /** Wires the WebSocket endpoints onto an HTTP server. */
  attach(server: Server): void;
}

export function createRelayApp(options: RelayAppOptions): RelayApp {
  const origin = canonicalRelayOrigin(options.origin);
  if (!origin) throw new Error(`GENERATORAI_RELAY_ORIGIN is not a valid origin: ${options.origin}`);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  const cell = new RelayCell({ origin, log: options.log });

  /**
   * Director endpoint.
   *
   * A single-process deployment always assigns the caller to its own cell. The
   * response shape is the multi-cell one so a fleet deployment can grow into it
   * without a protocol change. `cellUrl`/`directorUrl` are bare origins: the
   * host derives `/relay/host` and `/relay/data` from them via the shared route
   * table, and the pairing-offer schema requires exactly this shape.
   */
  app.get(RELAY_ROUTES.assignment, (req, res) => {
    const relayHostId = String(req.query['relayHostId'] ?? '');
    if (!/^[A-Za-z0-9_-]{43}$/.test(relayHostId)) {
      res.status(400).json({
        error: { code: 'INVALID_HOST_ID', message: 'relayHostId must be a 43-char base64url id.' },
      });
      return;
    }
    const assignment: RelayAssignment = {
      v: RELAY_PROTOCOL_VERSION,
      relayHostId,
      cellUrl: origin,
      directorUrl: origin,
      assignmentEpoch: 1,
      // Hosts re-register well before this; a short lease means a decommissioned
      // cell drains quickly instead of black-holing traffic.
      expiresAt: Date.now() + 60 * 60_000,
    };
    res.json(assignment);
  });

  app.get(RELAY_ROUTES.health, (_req, res) => {
    res.json({ ok: true, v: RELAY_PROTOCOL_VERSION, ...cell.stats() });
  });

  return {
    app,
    cell,
    origin,
    attach: (server) => cell.attach(server),
  };
}
