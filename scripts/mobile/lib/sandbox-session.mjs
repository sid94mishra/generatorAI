import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { assertSandboxDbPath, mergedFixture } from './sandbox-data.mjs';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const MOBILE = path.join(ROOT, 'apps/mobile');
export const STATE_DIR = path.join(os.tmpdir(), 'generatorai-mobile-sandbox');

export class SandboxSession {
  constructor(port = 3197) {
    if (!Number.isInteger(port) || port < 1024 || port > 63535) throw new Error('Sandbox port must be 1024…63535');
    this.port = port;
    this.origin = `http://127.0.0.1:${port}`;
    this.stateFile = path.join(STATE_DIR, port === 3197 ? 'state.json' : `state-${port}.json`);
    this.state = {};
  }
  async load() {
    try { this.state = JSON.parse(await fs.readFile(this.stateFile, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this.state;
  }
  async save() {
    await fs.mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
    const temporary = `${this.stateFile}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, this.stateFile);
  }
  async api(route, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`${this.origin}/api${route}`, {
      method, signal: AbortSignal.timeout(15000),
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!response.ok) throw Object.assign(new Error(`Sandbox ${method} ${route} failed (${response.status}): ${(await response.text()).slice(0,500)}`), { status: response.status });
    return response.status === 204 ? null : response.json();
  }
  async probe() {
    try {
      const response = await fetch(`${this.origin}/api/auth/server-info`, { signal: AbortSignal.timeout(2000) });
      return response.ok ? await response.json() : null;
    } catch { return null; }
  }
  async ensure({ trustRunning = false, dbPath } = {}) {
    await this.load();
    let info = await this.probe();
    if (info) {
      if (trustRunning) {
        if (!dbPath) throw new Error('--trust-running also requires --db-path after manually checking the startup log');
        this.state = { server: { dbPath: assertSandboxDbPath(dbPath), serverId: info.serverId,
          port: this.port, trustedManually: true, startedAt: new Date().toISOString() } };
        await this.save();
      } else {
        const saved = this.state.server;
        if (!saved || saved.serverId !== info.serverId || !saved.dbPath) {
          throw new Error(`A server on :${this.port} was not verified by sandbox-pair; stop it and rerun, or manually verify its dbPath before --trust-running`);
        }
        assertSandboxDbPath(saved.dbPath);
        if (saved.pid) {
          try { process.kill(saved.pid, 0); }
          catch { throw new Error('The recorded sandbox process is no longer alive; refusing to reuse its old state'); }
        }
      }
      return info;
    }
    // Never replace an occupied port with a different service whose identity endpoint is absent.
    const occupied = await new Promise(resolve => {
      const socket = net.connect({ host: '127.0.0.1', port: this.port });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
      socket.setTimeout(1500, () => { socket.destroy(); resolve(true); });
    });
    if (occupied) throw new Error(`Port ${this.port} is occupied by an unrecognized service`);
    await fs.mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
    const [web, mobile] = await Promise.all([
      fs.readFile(path.join(ROOT, 'agent-tests/vrt/fixtures/sandbox.faux.json'), 'utf8'),
      fs.readFile(path.join(MOBILE, 'e2e/fixtures/mobile.faux.json'), 'utf8'),
    ]);
    const fixture = path.join(STATE_DIR, this.port === 3197 ? 'faux.json' : `faux-${this.port}.json`);
    await fs.writeFile(fixture, JSON.stringify(mergedFixture(JSON.parse(web), JSON.parse(mobile))), { mode: 0o600 });
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts/redesign/sandbox.mjs'), `--port=${this.port}`], {
      cwd: ROOT, env: { ...process.env, GENERATORAI_ADVERTISED_URLS: `http://10.0.2.2:${this.port}`,
        GENERATORAI_SANDBOX_FAUX_SCRIPT: fixture }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    this.child = child;
    let buffer = '', verifiedPath;
    child.stdout.on('data', chunk => {
      process.stderr.write(chunk);
      buffer = (buffer + chunk).slice(-200000);
      const match = buffer.match(/\[sandbox\] server is on the temp DB: ([^\r\n]+)/);
      if (match) {
        try { verifiedPath = assertSandboxDbPath(match[1]); } catch { /* no trusted startup yet */ }
      }
    });
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    this.childFailure = null;
    child.on('error', error => { this.childFailure = error; });
    child.once('exit', (code, signal) => {
      if (!this.stopping) this.childFailure = new Error(`Sandbox exited (${signal ?? code})`);
      this.control?.close();
    });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (this.childFailure) throw this.childFailure;
      if (verifiedPath && buffer.includes('Sandbox ready:') && (info = await this.probe())) break;
      await delay(300);
    }
    if (!verifiedPath || !info) throw new Error('Sandbox did not report its temporary dbPath and identity within 90 seconds');
    const controlId = `gai-mobile-${randomUUID()}`;
    const controlPath = process.platform === 'win32' ? `\\\\.\\pipe\\${controlId}` : path.join(os.tmpdir(), `${controlId}.sock`);
    this.control = net.createServer(socket => {
      let message = '';
      socket.setTimeout(2000, () => socket.destroy());
      socket.on('data', chunk => {
        message += chunk;
        if (message.length > 32) return socket.destroy();
        if (message === 'stop\n') {
          socket.end('stopping\n');
          void this.shutdown().catch(error => console.error(error.message));
        }
      });
    });
    await new Promise((resolve, reject) => { this.control.once('error', reject); this.control.listen(controlPath, resolve); });
    if (process.platform !== 'win32') await fs.chmod(controlPath, 0o600);
    this.state = { server: { pid: child.pid, supervisorPid: process.pid, serverId: info.serverId,
      dbPath: verifiedPath, startedAt: new Date().toISOString(), port: this.port, controlPath }, chats: {}, paired: [] };
    await this.save();
    return info;
  }
  async shutdown() {
    if (this.stopping || !this.child) return;
    this.stopping = true;
    const child = this.child;
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      // The sandbox handles IPC on Windows as well as POSIX; no signal-only orphaning.
      if (child.connected) child.send({ type: 'shutdown' });
      const done = await Promise.race([exited.then(() => true), delay(12000, undefined, { ref: false }).then(() => false)]);
      if (!done) throw new Error('Sandbox did not stop cleanly; inspect its process before retrying');
    }
    this.control?.close();
    await this.load();
    if (this.state.server?.pid === child.pid) { this.state.server.stoppedAt = new Date().toISOString(); await this.save(); }
  }
  async requestStop() {
    await this.load();
    const info = await this.probe();
    const saved = this.state.server;
    if (!info || !saved?.controlPath || saved.serverId !== info.serverId) throw new Error('No matching sandbox-pair-owned server to stop');
    assertSandboxDbPath(saved.dbPath);
    await new Promise((resolve, reject) => {
      const socket = net.connect(saved.controlPath);
      socket.once('connect', () => socket.write('stop\n'));
      socket.once('data', data => { socket.destroy(); data.toString() === 'stopping\n' ? resolve() : reject(new Error('Unexpected sandbox control response')); });
      socket.once('error', reject);
      socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('Sandbox control socket did not respond')); });
    });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { if (!(await this.probe())) return; await delay(250); }
    throw new Error('Sandbox is still responding after its shutdown request');
  }
}
