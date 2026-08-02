// Dev launcher — builds the main/preload bundle + icons, then launches Electron
// pointed at the running Vite dev server (web HMR), instead of spawning the
// embedded production server. Run `pnpm dev` (server + web) in another terminal.

import { spawnSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function run(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) {
    console.error(`Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(res.status ?? 1);
  }
}

run('pnpm', ['run', 'build:bundle']);
run('pnpm', ['run', 'build:resources']);

const url = process.env.DESKTOP_DEV_SERVER_URL || 'http://localhost:5173';
console.log(`Launching Electron against dev server: ${url}`);

const child = spawn(electronPath, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, DESKTOP_DEV_SERVER_URL: url },
});
child.on('exit', (code) => process.exit(code ?? 0));
