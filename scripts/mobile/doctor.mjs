#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { pnpmCommand } from '../redesign/lib/spawn-node-bin.mjs';
import { agentCommand } from './lib/agent-command.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mobile = path.join(root, 'apps/mobile');
const devices = JSON.parse(fs.readFileSync(path.join(mobile, 'vrt/devices.json'), 'utf8'));
const { values } = parseArgs({ options: { json: { type: 'boolean' }, create: { type: 'boolean' }, help: { type: 'boolean' } } });
if (values.help) {
  console.log('Usage: node scripts/mobile/doctor.mjs [--json] [--create]');
  console.log('--create creates missing named test devices; it never erases existing devices.');
  process.exit(0);
}
const win = process.platform === 'win32';
const report = { os: process.platform, ready: [], versions: {}, devices: { ios: [], android: [] }, checks: [] };
function run(command, args = [], options = {}) {
  // Only SDK batch launchers need cmd.exe. Their arguments are fixed flags or
  // values from the committed device inventory, never a pairing URL or token.
  if (win && /\.(bat|cmd)$/i.test(command)) {
    const quoted = [command, ...args].map(value => {
      if (/["%\r\n]/.test(value)) throw new Error('Unsupported character in Windows SDK command');
      return `"${value}"`;
    }).join(' ');
    args = ['/d', '/s', '/c', `"${quoted}"`];
    command = process.env.ComSpec ?? 'cmd.exe';
  }
  try {
    return execFileSync(command, args, { cwd: root, encoding: 'utf8', timeout: 30000,
      maxBuffer: 4 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim();
  } catch (error) {
    throw new Error([error.message, error.stdout].filter(Boolean).join('\n').slice(-8000));
  }
}
function add(name, platforms, check, fix, required = true) {
  try {
    const detail = check();
    report.checks.push({ name, platforms, ok: true, required, detail });
    return detail;
  } catch (error) {
    report.checks.push({ name, platforms, ok: false, required, detail: error.message, fix });
    return undefined;
  }
}
function ensure(condition, message) { if (!condition) throw new Error(message); }
const both = process.platform === 'darwin' ? ['ios', 'android'] : ['android'];
add('Node', both, () => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  ensure((major === 22 && minor >= 13) || major > 24 || (major === 24 && minor >= 3), 'Node 22.13+ (22.x) or 24.3+ required');
  return report.versions.node = process.versions.node;
}, 'Install Node 22 LTS (>=22.13), or Node >=24.3.');
add('pnpm', both, () => {
  const cmd = pnpmCommand(['--version']);
  const version = run(cmd.command, cmd.args, cmd.options);
  ensure(/^10\./.test(version), `pnpm 10 required, found ${version}`);
  return report.versions.pnpm = version;
}, 'corepack prepare pnpm@10.29.2 --activate');
if (process.platform === 'darwin') {
  add('Xcode', ['ios'], () => {
    const selected = run('xcode-select', ['-p']);
    ensure(selected.endsWith('Xcode.app/Contents/Developer'), `Unexpected developer directory: ${selected}`);
    const version = run('xcodebuild', ['-version']);
    ensure(Number(version.match(/Xcode (\d+)/)?.[1]) >= 27, version);
    report.versions.xcode = version;
    return selected;
  }, 'sudo xcode-select -s /Applications/Xcode.app && sudo xcodebuild -license accept');
  add('iOS devices', ['ios'], () => {
    const runtimes = JSON.parse(run('xcrun', ['simctl', 'list', 'runtimes', '--json'])).runtimes;
    const types = JSON.parse(run('xcrun', ['simctl', 'list', 'devicetypes', '--json'])).devicetypes;
    let available = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', '--json'])).devices;
    for (const device of Object.values(devices.ios)) {
      const runtime = runtimes.find(r => r.name === device.runtime && r.isAvailable);
      ensure(runtime, `Missing ${device.runtime} runtime`);
      let matches = (available[runtime.identifier] ?? []).filter(d => d.name === device.name && d.isAvailable);
      if (!matches.length && values.create) {
        const type = types.find(t => t.name === device.deviceType);
        ensure(type, `Missing device type ${device.deviceType}`);
        run('xcrun', ['simctl', 'create', device.name, type.identifier, runtime.identifier]);
        available = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', '--json'])).devices;
        matches = (available[runtime.identifier] ?? []).filter(d => d.name === device.name && d.isAvailable);
      }
      ensure(matches.length === 1, `Expected one available ${device.name} on ${device.runtime}; found ${matches.length}`);
      report.devices.ios.push({ name: device.name, udid: matches[0].udid, state: matches[0].state, runtime: runtime.name });
    }
    return report.devices.ios;
  }, 'xcodebuild -downloadPlatform iOS; then node scripts/mobile/doctor.mjs --create');
}
add('JDK', ['android'], () => {
  ensure(process.env.JAVA_HOME, 'JAVA_HOME is not set');
  const java = path.join(process.env.JAVA_HOME, 'bin', win ? 'java.exe' : 'java');
  const output = run(java, ['--version']);
  ensure(Number(output.match(/(?:openjdk|java) (\d+)/)?.[1]) >= 17, `JDK 17+ required: ${output}`);
  return report.versions.java = output;
}, 'Install JDK 17 and set JAVA_HOME to its directory (macOS: /usr/libexec/java_home -v 17).');
const sdk = process.env.ANDROID_HOME;
const sdkTool = (directory, name, batch = false) => path.join(sdk ?? '', directory, `${name}${win ? (batch ? '.bat' : '.exe') : ''}`);
add('Android SDK', ['android'], () => {
  ensure(sdk, 'ANDROID_HOME is not set');
  report.versions.adb = run(sdkTool('platform-tools', 'adb'), ['version']);
  report.versions.emulator = run(sdkTool('emulator', 'emulator'), ['-version']);
  report.versions.sdkmanager = run(sdkTool('cmdline-tools/latest/bin', 'sdkmanager', true), ['--version']);
  return sdk;
}, 'Set ANDROID_HOME to the Android SDK and install platform-tools, emulator and cmdline-tools; see 08-verification.md §1.');
add('Android devices', ['android'], () => {
  ensure(sdk, 'ANDROID_HOME is not set');
  const abi = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
  const installed = run(sdkTool('cmdline-tools/latest/bin', 'sdkmanager', true), ['--list_installed']);
  let avds = run(sdkTool('emulator', 'emulator'), ['-list-avds']).split(/\r?\n/);
  for (const device of Object.values(devices.android)) {
    const image = device.image.replace(/(?:arm64-v8a|x86_64)$/, abi);
    const hasImage = installed.includes(image);
    if (!hasImage && device.optional) {
      report.devices.android.push({ avd: device.avd, image, available: false, optional: true });
      continue;
    }
    ensure(hasImage, `Missing image: sdkmanager --install "${image}"`);
    if (!avds.includes(device.avd) && values.create) {
      run(sdkTool('cmdline-tools/latest/bin', 'avdmanager', true), ['create', 'avd', '-n', device.avd, '-k', image, '-d', device.device], { input: 'no\n' });
      avds = run(sdkTool('emulator', 'emulator'), ['-list-avds']).split(/\r?\n/);
    }
    ensure(avds.includes(device.avd) || device.optional, `Missing AVD ${device.avd}`);
    report.devices.android.push({ avd: device.avd, image, available: avds.includes(device.avd), optional: !!device.optional });
  }
  const connected = run(sdkTool('platform-tools', 'adb'), ['devices']);
  report.devices.androidConnected = connected.split(/\r?\n/).filter(line => /\tdevice$/.test(line)).map(line => line.split('\t')[0]);
  return report.devices.android;
}, 'Install the listed image with sdkmanager, then node scripts/mobile/doctor.mjs --create.');
add('Maestro', both, () => {
  const local = path.join(os.homedir(), '.maestro', 'bin', win ? 'maestro.bat' : 'maestro');
  const version = run(fs.existsSync(local) ? local : 'maestro', ['--version'], {
    env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1' }, timeout: 45000,
  });
  ensure(/2\.10\.\d+/.test(version), `Maestro 2.10.x required: ${version}`);
  return report.versions.maestro = version;
}, 'Install Maestro 2.10.0 from its official release; see 08-verification.md §1.');
add('agent-device', both, () => {
  const cmd = agentCommand(['--version']);
  const version = run(cmd.command, cmd.args);
  ensure(/0\.21\.15/.test(version), `agent-device 0.21.15 required: ${version}`);
  report.versions.agentDevice = version;
  const doctor = agentCommand(['doctor', '--json']);
  return JSON.parse(run(doctor.command, doctor.args, { timeout: 45000 }));
}, 'pnpm install (M1-03 pins agent-device 0.21.15 in root devDependencies).');
add('Expo doctor', both, () => {
  const cmd = pnpmCommand(['dlx', 'expo-doctor']);
  return run(cmd.command, cmd.args, { ...cmd.options, cwd: mobile, timeout: 60000, env: { ...process.env, CI: '1' } });
}, 'Run pnpm dlx expo-doctor from apps/mobile and review its report.', false);

async function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1500, () => finish(true));
  });
}
for (const [port, endpoint, expected] of [
  [3197, '/api/auth/server-info', /serverId/],
  [5197, '/', /GeneratorAI/i],
  [8081, '/status', /packager-status:running/],
  [7007, '/', /storybook/i],
]) {
  let ok = true, detail = 'free';
  if (await portOpen(port)) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, { signal: AbortSignal.timeout(2000) });
      ok = response.ok && expected.test(await response.text());
      detail = ok ? 'expected service responds' : 'occupied by an unrecognized service';
    } catch { ok = false; detail = 'occupied; expected service did not respond'; }
  }
  report.checks.push({ name: `port ${port}`, platforms: both, ok, required: true, detail,
    ...(ok ? {} : { fix: `Inspect the process on port ${port}; stop it only if it belongs to this task.` }) });
}
report.ready = both.filter(platform => report.checks.every(check => !check.required || !check.platforms.includes(platform) || check.ok));
if (values.json) console.log(JSON.stringify(report, null, 2));
else {
  for (const check of report.checks) {
    console.log(`${check.ok ? 'ok' : check.required ? 'FAIL' : 'note'}: ${check.name}`);
    if (!check.ok) console.log(`  ${check.detail}\n  Fix: ${check.fix}`);
  }
  for (const device of report.devices.ios) console.log(`ios: ${device.name} ${device.udid} (${device.state})`);
  for (const device of report.devices.android) console.log(`android: ${device.avd} (${device.available ? device.image : 'optional image unavailable'})`);
  console.log(`ready: ${report.ready.length ? report.ready.join(', ') : 'none'}`);
}
process.exitCode = report.ready.length === both.length ? 0 : 1;
