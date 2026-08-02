// Interactive launcher — spawns Electron with the native browser flag on
// and forwards stdout/stderr so we can watch startup logs live. Meant to
// be run from a terminal that stays open while a human (or Playwright)
// drives the app.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';

const DESKTOP = path.resolve(process.cwd());
const requireFromDesktop = createRequire(path.join(DESKTOP, 'package.json'));
const ELECTRON = requireFromDesktop('electron');

// Point the embedded server at the repo/dev database (and its workspaces +
// artifacts) instead of the standalone per-user app-data DB, so the desktop
// shell shows the same chats / workflows / projects as the web dev server.
const REPO_ROOT = path.resolve(DESKTOP, '..', '..');
const DEV_DB_PATH = path.join(REPO_ROOT, 'packages', 'db', 'data', 'generatorai.db');
const DEV_WORKSPACES_DIR = path.join(os.homedir(), '.generatorai', 'workspaces');
const DEV_ARTIFACTS_DIR = path.join(os.homedir(), '.generatorai', 'artifacts');

console.log(`[launcher] Electron: ${ELECTRON}`);
console.log(`[launcher] cwd: ${DESKTOP}`);
console.log(`[launcher] flags: GENERATORAI_DESKTOP_NATIVE_BROWSER=1`);
console.log(`[launcher] DB_PATH: ${DEV_DB_PATH}`);

const child = spawn(ELECTRON, ['.'], {
  cwd: DESKTOP,
  env: {
    ...process.env,
    GENERATORAI_DESKTOP_MODE: 'standalone',
    GENERATORAI_DESKTOP_NATIVE_BROWSER: '1',
    GENERATORAI_LOG_LEVEL: 'info',
    // Share the dev/web data so the desktop app lists the same content.
    DB_PATH: process.env.DB_PATH ?? DEV_DB_PATH,
    WORKSPACES_DIR: process.env.WORKSPACES_DIR ?? DEV_WORKSPACES_DIR,
    ARTIFACTS_DIR: process.env.ARTIFACTS_DIR ?? DEV_ARTIFACTS_DIR,
  },
});

child.stdout.on('data', (b) => process.stdout.write(b));
child.stderr.on('data', (b) => process.stderr.write(b));
child.on('exit', (code) => { console.log(`[launcher] Electron exited: ${code}`); process.exit(code ?? 0); });

process.on('SIGINT', () => { try { child.kill(); } catch {} process.exit(0); });
