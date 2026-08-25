/**
 * W17 — CUA Host server process.
 *
 * Owns the computer-use driver. Writes a connection descriptor on startup
 * (atomic tmp+rename, mode 0600) so the gateway can verify the host is alive.
 * The gateway never calls the CUA driver directly (L5).
 *
 * Implements fused act+settle+capture: one IPC round-trip per action.
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

/** Milliseconds to wait for the system to settle after a mouse/keyboard action. */
const SETTLE_DELAY_MS = 200;

export class CuaHostServer {
  /* W17 */
  private readonly bootTime = Date.now();
  private descriptorPath = '';

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
          await this.performAction(action as { type: string } & Record<string, unknown>);
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
   * Perform a computer-use action. In production this will delegate to the
   * platform CUA driver (pyautogui, xdotool, AppleScript, etc.).
   * The driver integration is injected via GENERATORAI_CUA_DRIVER env var.
   *
   * For now we log the action and no-op; the host is wired but the driver
   * binding is done in the platform-specific integration layer.
   */
  private async performAction(action: { type: string } & Record<string, unknown>): Promise<void> {
    console.log(`[CuaHostServer] Performing action: ${action.type}`, action);
    // TODO: delegate to platform driver once CUA driver package is available
    // e.g. await cuaDriver.perform(action);
  }

  /**
   * Capture the current screen state. In production this uses the platform
   * screenshot API. Returns a base-64 encoded JPEG/PNG string.
   */
  private async captureScreen(): Promise<string> {
    // TODO: implement with platform driver; placeholder returns empty base64
    console.log('[CuaHostServer] Capturing screen');
    return '';
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
