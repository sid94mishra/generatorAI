/**
 * W17 — CUA Host server process.
 *
 * Owns the computer-use driver. Writes a connection descriptor on startup
 * (atomic tmp+rename, mode 0600) so the gateway can verify the host is alive.
 * The gateway never calls the CUA driver directly (L5).
 *
 * △ THE FUSION IN W17 IS NOT IMPLEMENTED. This header used to claim
 * "fused act+settle+capture: one IPC round-trip per action", which is a
 * different claim from W17's acceptance criterion AND is not what the code
 * below does. Both halves of that matter:
 *
 *   • W17's criterion is "one click = one DRIVER round trip". Counting IPC
 *     round trips instead measures the gateway hop, which is the cheap half.
 *   • A `perform_action` with `captureAfter` is currently SIX driver round
 *     trips: `resolveFocusedWindow()` (list_apps + list_windows) and the
 *     action itself, then `resolveFocusedWindow()` AGAIN plus
 *     `get_window_state` inside `captureScreen()` — and the frame comes back
 *     via a full-screen PNG written to `os.tmpdir()` and read straight back.
 *
 * `__tests__/CuaDriverConnection.test.ts` pins that count so the number W17
 * has to move is measured rather than asserted. See `CuaHostIpc.ts` for the
 * protocol defect that must be fixed before this host is wired at all.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  CuaHostRequest,
  CuaHostResponse,
  CuaConnectionDescriptor,
} from '@generatorai/shared';
import { isCuaHostRequest } from '@generatorai/shared';
import type { ComputerAction } from '@generatorai/shared';
import { CuaDriverConnection, type DriverModule } from './CuaDriverConnection.js';

/** Milliseconds to wait for the system to settle after a mouse/keyboard action. */
const SETTLE_DELAY_MS = 200;

export class CuaHostServer {
  /* W17 */
  private readonly bootTime = Date.now();
  private descriptorPath = '';
  private readonly driver: CuaDriverConnection;

  /** `driverModule` is injectable for tests; production loads the real `@trycua/cua-driver` package. */
  constructor(driverModule?: DriverModule) {
    this.driver = new CuaDriverConnection(driverModule);
  }

  start(): void {
    if (typeof process.send !== 'function') {
      throw new Error('[CuaHostServer] Not running as a forked child process — process.send unavailable');
    }

    process.on('message', (raw: unknown) => {
      if (!isCuaHostRequest(raw)) {
        console.warn('[CuaHostServer] Received unrecognised IPC message');
        return;
      }
      this.handleRequest(raw as CuaHostRequest).catch((err: unknown) => {
        console.error(`[CuaHostServer] Unhandled error: ${String(err)}`);
      });
    });

    // Write connection descriptor (async, but fire-and-forget for startup speed)
    void this.writeDescriptor().then(() => {
      this.send({ type: 'pong', reqId: '__ready__' });
      console.log('[CuaHostServer] CUA host ready');
    });
  }

  private send(msg: CuaHostResponse): void {
    process.send!(msg);
  }

  private async writeDescriptor(): Promise<void> {
    const dataDir = process.env['GENERATORAI_DATA_DIR'] ?? os.tmpdir();
    this.descriptorPath = path.join(dataDir, 'cua-connection.json');

    const descriptor: CuaConnectionDescriptor = {
      descriptorPath: this.descriptorPath,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      version: 1,
    };

    // Atomic write: tmp → rename
    const tmpPath = `${this.descriptorPath}.${randomUUID()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(descriptor, null, 2), { mode: 0o600 });
    await fs.rename(tmpPath, this.descriptorPath);
  }

  private async handleRequest(req: CuaHostRequest): Promise<void> {
    switch (req.type) {
      case 'ping':
        this.send({ type: 'pong', reqId: req.reqId });
        return;

      case 'get_state':
        this.send({
          type: 'state',
          reqId: req.reqId,
          connected: true,
          descriptorPath: this.descriptorPath,
        });
        return;

      case 'capture': {
        const { reqId, captureId } = req;
        try {
          const screenshot = await this.captureScreen();
          this.send({ type: 'capture_result', reqId, captureId, screenshot });
        } catch (err: unknown) {
          this.send({ type: 'error', reqId, ok: false, message: String(err) });
        }
        return;
      }

      case 'perform_action': {
        const { reqId, actionId, action, captureAfter } = req;
        try {
          await this.performAction(action);
          // Settle delay — let the OS process the action before capturing
          if (captureAfter) {
            await new Promise<void>((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
            const screenshot = await this.captureScreen();
            this.send({ type: 'action_result', reqId, actionId, success: true, screenshot });
          } else {
            this.send({ type: 'action_result', reqId, actionId, success: true });
          }
        } catch (err: unknown) {
          this.send({ type: 'action_result', reqId, actionId, success: false, error: String(err) });
        }
        return;
      }

      default: {
        const unknown = req as { type: string; reqId?: string };
        console.warn(`[CuaHostServer] Unknown request type: ${unknown.type}`);
        if (unknown.reqId) {
          this.send({ type: 'error', reqId: unknown.reqId, ok: false, message: `Unknown type: ${unknown.type}` });
        }
      }
    }
  }

  /**
   * Perform a computer-use action via the real `@trycua/cua-driver` SDK —
   * see `CuaDriverConnection.performAction()` for the actual mapping.
   */
  private async performAction(action: ComputerAction): Promise<void> {
    await this.driver.performAction(action);
  }

  /**
   * Capture a real screenshot of the currently focused window via the
   * driver — see `CuaDriverConnection.captureScreen()`. Returns a base-64
   * encoded PNG.
   */
  private async captureScreen(): Promise<string> {
    return this.driver.captureScreen();
  }

  async shutdown(): Promise<void> {
    // Clean up descriptor file on graceful shutdown
    try {
      if (this.descriptorPath) await fs.unlink(this.descriptorPath);
    } catch {
      // Best-effort
    }
    console.log('[CuaHostServer] Shutdown complete');
  }
}
