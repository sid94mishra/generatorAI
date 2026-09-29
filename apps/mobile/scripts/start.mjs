#!/usr/bin/env node
// Expo binds --localhost using Node's DNS order. Prefer IPv4 so the simulator
// and Android adb-reverse share the 127.0.0.1 URL used by sandbox-pair.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const expoCli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin', 'cli');
const child = spawn(process.execPath, ['--dns-result-order=ipv4first', expoCli, 'start', ...process.argv.slice(2)], {
  stdio: 'inherit', env: process.env,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
