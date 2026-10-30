// ────────────────────────────────────────────────────────────────
// Launches the desktop app for a smoke: the unpackaged build through
// Playwright's Electron driver (the default), or — with
// GENERATORAI_SMOKE_EXECUTABLE=<packaged binary> — the packaged app.
//
// The packaged binary ships with the RunAsNode / NODE_OPTIONS / --inspect fuses
// off (F-4, D-128), and Playwright's `_electron.launch` drives the main process
// through the Node inspector, so it cannot attach there. The packaged app is
// started as a user would start it, plus Chromium's renderer-only
// `--remote-debugging-port`, and its windows are reached over CDP. Either way
// the caller gets `windows()` and `close()`.
// ────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import net from 'node:net';
import { _electron as electron, chromium } from 'playwright';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * @param {{ args: string[], env: NodeJS.ProcessEnv, timeout?: number }} options
 *   `args[0]` is the app directory for the unpackaged build; it is dropped for the packaged one.
 * @returns {Promise<{ packaged: boolean, windows: () => import('playwright').Page[], close: () => Promise<void> }>}
 */
export async function launchDesktop({ args, env, timeout = 120_000 }) {
  const executable = process.env.GENERATORAI_SMOKE_EXECUTABLE;
  if (!executable) {
    const app = await electron.launch({ args, env, timeout });
    return { packaged: false, windows: () => app.windows(), close: () => app.close() };
  }
  const port = await freePort();
  const child = spawn(executable, [...args.slice(1), `--remote-debugging-port=${port}`], { env, stdio: 'ignore' });
  let browser = null;
  const deadline = Date.now() + timeout;
  while (!browser && Date.now() < deadline) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
    if (!browser) await new Promise((r) => setTimeout(r, 500));
  }
  if (!browser) {
    child.kill('SIGKILL');
    throw new Error(`packaged app exposed no renderer CDP endpoint on :${port} within ${timeout} ms`);
  }
  return {
    packaged: true,
    windows: () => browser.contexts().flatMap((c) => c.pages()),
    close: async () => {
      await browser.close().catch(() => {});
      if (child.exitCode !== null) return;
      const exited = new Promise((r) => child.once('exit', r));
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t'], { windowsHide: true });
      else child.kill('SIGTERM');
      await Promise.race([exited, new Promise((r) => setTimeout(r, 15_000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    },
  };
}
