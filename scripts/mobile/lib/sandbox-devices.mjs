import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { agentCommand } from './agent-command.mjs';
import { ROOT } from './sandbox-session.mjs';
import { rewritePairUrl } from './sandbox-data.mjs';

const execute = promisify(execFile);
const activeCommands = new Set();
async function executeDevice(command, args, options) {
  const request = execute(command, args, options);
  activeCommands.add(request.child);
  try { return await request; }
  finally { activeCommands.delete(request.child); }
}
export function cancelDeviceCommands() { for (const child of activeCommands) child.kill(); }
export const APP_ID = 'dev.generatorai.app';
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  ?? (process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Android/sdk')
    : process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'Android/Sdk') : path.join(os.homedir(), 'Android/Sdk'));
export const ADB = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
export async function run(command, args, timeout = 60000, env = process.env) {
  // Deliberately omit stderr/argv from failures: a deep-link argument can contain a grant.
  try { return (await executeDevice(command, args, { cwd: ROOT, timeout, env, maxBuffer: 8 * 1024 * 1024 })).stdout.trim(); }
  catch (error) { throw new Error(`${path.basename(command)} ${args[0] ?? ''} failed (${error.code ?? 'timeout'})`); }
}
export async function findTargets({ platform, udid, serial } = {}) {
  if (platform && !['ios', 'android'].includes(platform)) throw new Error('--platform must be ios or android');
  if ((udid && platform === 'android') || (serial && platform === 'ios')) throw new Error('Device selector and platform disagree');
  const targets = [];
  if (process.platform === 'darwin' && platform !== 'android' && !serial) {
    const inventory = JSON.parse(await run('xcrun', ['simctl', 'list', 'devices', 'booted', '--json']));
    for (const device of Object.values(inventory.devices).flat()) {
      if (device.state === 'Booted' && (udid ? device.udid === udid : ['gai-iphone', 'gai-ipad'].includes(device.name))) {
        targets.push({ platform: 'ios', udid: device.udid, name: device.name });
      }
    }
  }
  if (platform !== 'ios' && !udid && fs.existsSync(ADB)) {
    const inventory = await run(ADB, ['devices']);
    for (const line of inventory.split('\n')) {
      const match = line.match(/^(\S+)\s+device$/);
      if (!match || (serial && match[1] !== serial)) continue;
      const id = match[1];
      const emulator = id.startsWith('emulator-');
      const name = emulator ? (await run(ADB, ['-s', id, 'emu', 'avd', 'name'])).split('\n')[0].trim() : id;
      if (serial || ['gai-phone', 'gai-tablet', 'gai-phone-37'].includes(name)) {
        targets.push({ platform: 'android', serial: id, name, physical: !emulator });
      }
    }
  }
  if (!targets.length) throw new Error('No selected test device is booted; boot gai-iphone or gai-phone first');
  return targets;
}
export function targetId(target) { return target.udid ?? target.serial; }
export function targetHost(target) { return target.platform === 'ios' || target.physical ? '127.0.0.1' : '10.0.2.2'; }
export async function installedBuild(target) {
  if (target.platform === 'android') {
    const dump = await run(ADB, ['-s', targetId(target), 'shell', 'dumpsys', 'package', APP_ID]);
    return /\bDEBUGGABLE\b/.test(dump) ? 'dev' : 'release';
  }
  const container = await run('xcrun', ['simctl', 'get_app_container', targetId(target), APP_ID, 'app']);
  return fs.existsSync(path.join(container, 'main.jsbundle')) ? 'release' : 'dev';
}
export async function agent(target, args) {
  const invocation = agentCommand([
    ...args, ...(args.includes('--json') ? [] : ['--json']), '--platform', target.platform, '--session', `mobile-${targetId(target)}`,
    target.platform === 'ios' ? '--udid' : '--serial', targetId(target),
  ]);
  try {
    const result = await executeDevice(invocation.command, invocation.args, { cwd: ROOT, timeout: 360000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, ANDROID_HOME: sdk,
        PATH: [path.join(sdk, 'platform-tools'), path.join(sdk, 'emulator'), process.env.PATH ?? ''].join(path.delimiter) },
    });
    return result.stdout.trim();
  } catch (error) {
    // Preserve a useful diagnostic without printing selectors, argv or grants.
    let diagnostic;
    try { diagnostic = JSON.parse(error.stdout).error; } catch { /* Non-JSON CLI failure. */ }
    const code = /^[A-Z_]+$/.test(diagnostic?.code ?? '') ? diagnostic.code : error.code ?? 'timeout';
    const id = /^[a-z0-9-]+$/i.test(diagnostic?.diagnosticId ?? '') ? `; diagnostic ${diagnostic.diagnosticId}` : '';
    throw Object.assign(new Error(`agent-device ${args[0]} failed (${code}${id}); inspect its session log`), { code });
  }
}
export async function releaseAgent(target) {
  // XCTest/UiAutomator runners must relinquish the selected device before
  // Maestro starts its own runner. Only touch this helper's named session.
  try { await agent(target, ['close']); }
  catch (error) { if (error.code !== 'SESSION_NOT_FOUND') throw error; }
}
export async function mintPair(session, target) {
  const offer = await session.api('/auth/pair', { deviceName: target.name ?? `gai-${target.platform}`, platform: 'mobile', ttlMs: 600000 });
  return rewritePairUrl(offer.pairingUrl, target.physical ? 'ios' : target.platform, session.port);
}
// The pinned driver's iOS presentation heuristic treats an empty fullscreen
// toolbar as an overlay. Raw XCTest preserves the native hittability/refs;
// fill/press still enforce keyboard and target checks. No coordinate fallback.
async function readSnapshot(target, interactive = true) {
  const deadline = Date.now() + 15000;
  let lastError;
  do {
    try { return JSON.parse(await agent(target, ['snapshot', ...(target.platform === 'ios' ? ['--raw'] : interactive ? ['-i'] : []), '--timeout', '5000'])); }
    catch (error) { lastError = error; await delay(500); }
  } while (Date.now() < deadline);
  throw lastError;
}
async function confirmAppLink(target, snapshot) {
  const nodes = snapshot?.nodes ?? [];
  const alert = nodes.find(node => node.type === 'Alert' && /^Open in [“"]GeneratorAI[”"]\?$/.test(node.label ?? ''));
  if (alert && nodes.some(node => node.type === 'Button' && node.label === 'Open' && node.parentIndex === alert.index)) {
    await agent(target, ['press', 'label="Open"', '--settle']);
  }
}
async function pressExpoControl(target, nodes, label) {
  const control = nodes.find(node => node.label === label && /Button$/.test(node.type ?? ''))
    ?? nodes.find(node => node.label === label);
  if (!control?.ref) throw new Error(`Expo ${label} control is missing from the native snapshot`);
  await agent(target, ['press', `@${control.ref}`, '--settle']);
}
async function waitForApp(target) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    let snapshot;
    try {
      const result = JSON.parse(await agent(target, ['snapshot', ...(target.platform === 'ios' ? ['--raw'] : []), '--json', '--timeout', '15000']));
      snapshot = result.data?.snapshot ?? result.data;
    } catch { /* The first Metro bundle can temporarily leave no readable native tree. */ }
    const nodes = snapshot?.nodes ?? [];
    const labels = nodes.map(node => node.label ?? node.value ?? '');
    // Expo's first-run tutorial covers the app after the initial bundle. Match
    // its explanatory copy so a product consent button is never auto-dismissed.
    if (labels.some(label => label.includes('This is the developer menu.')) && labels.includes('Continue')) {
      await pressExpoControl(target, nodes, 'Continue');
      continue;
    }
    if (labels.includes('Open DevTools') && (labels.includes('Open React Native dev menu') || labels.includes('Toggle performance monitor')) && labels.includes('Close')) {
      await pressExpoControl(target, nodes, 'Close');
      continue;
    }
    if (nodes.some(node => node.identifier === 'menu-button' || node.label === 'Pair this phone' || node.label === 'Fingerprint' || node.label === 'Pair this device')) return;
    if (nodes.some(node => node.label === 'Unlock to continue')) throw new Error('The installed app is locked; unlock it before native verification');
    await confirmAppLink(target, snapshot);
    await delay(500);
  }
  throw new Error('The app did not reach its pairing screen or shell within 120 seconds; check Metro and native logs');
}
export async function pairTarget(session, target, { repair = false, noConfirm = false } = {}) {
  const id = targetId(target);
  const installed = target.platform === 'ios'
    ? await run('xcrun', ['simctl', 'get_app_container', id, APP_ID])
    : await run(ADB, ['-s', id, 'shell', 'pm', 'path', APP_ID]);
  if (!installed) throw new Error(`Build the ${target.platform} dev client first (expo run:${target.platform})`);
  if (target.physical) await run(ADB, ['-s', id, 'reverse', `tcp:${session.port}`, `tcp:${session.port}`]);
  const { devices } = await session.api('/auth/devices');
  const saved = (session.state.paired ?? []).find(item => targetId(item) === id);
  if (!repair && saved && devices.some(device => device.deviceId === saved.deviceId && !device.revokedAt)) {
    console.log(`pair: ${target.name} already paired`);
    return;
  }
  console.log(`pair: opening ${target.name}`);
  // Open the known app first to establish agent-device's foreground session and initial snapshot.
  // A freshly installed dev client otherwise stays on Expo's launcher, before app routing exists.
  const openArgs = ['open', APP_ID, '--foreground'];
  let devClientUrl;
  if (await installedBuild(target) === 'dev') {
    const metro = await fetch('http://127.0.0.1:8081/status', { signal: AbortSignal.timeout(2000) }).catch(() => null);
    if (!metro?.ok || !(await metro.text()).includes('packager-status:running')) throw new Error('Start the mobile Metro dev server on :8081 before pairing a dev client');
    if (target.physical) await run(ADB, ['-s', id, 'reverse', 'tcp:8081', 'tcp:8081']);
    const host = targetHost(target);
    devClientUrl = `exp+generatorai://expo-development-client/?url=${encodeURIComponent(`http://${host}:8081`)}&disableFab=1&disableOnboarding=1&disableAutoLaunch=1`;
    // Reusing a live Expo React context through the launcher can crash SDK 57
    // on Android. Start a fresh dev-client process before choosing its bundle.
    openArgs.push('--metro-host', host, '--metro-port', '8081');
    if (target.platform === 'android') openArgs.push('--relaunch', '--launch-url', devClientUrl);
  }
  if (target.platform === 'ios') await agent(target, ['prepare', 'ios-runner', '--timeout', '300000']);
  const opened = JSON.parse(await agent(target, [...openArgs, '--json']));
  await confirmAppLink(target, opened.data?.snapshot);
  const initialNodes = opened.data?.snapshot?.nodes ?? [];
  if (target.platform === 'ios' && devClientUrl && initialNodes.some(node => node.label === 'Development Build')) {
    // On iOS the driver's runtime hint can leave Expo's native launcher open.
    // Explicitly select Metro only when that observed launcher is still visible.
    const recent = initialNodes.find(node => node.type === 'Button' && node.label?.endsWith(`http://${targetHost(target)}:8081`));
    if (recent?.ref) await agent(target, ['press', `@${recent.ref}`, '--settle']);
    else await run('xcrun', ['simctl', 'openurl', id, devClientUrl]);
  }
  await waitForApp(target);
  console.log(`pair: ${target.name} app ready; opening consent`);
  if (target.platform === 'android') await agent(target, ['settings', 'permission', 'grant', 'notifications']);
  else {
    const privacy = await run('xcrun', ['simctl', 'help', 'privacy']);
    if (/^\s*notifications\s+-/m.test(privacy)) await agent(target, ['settings', 'permission', 'grant', 'notifications']);
    else console.log('pair: iOS notifications require native consent; simctl has no notification service (MD-99)');
  }
  const before = new Set(devices.map(device => device.deviceId));
  const started = Date.now();
  const url = await mintPair(session, target);
  if (target.platform === 'ios') await run('xcrun', ['simctl', 'openurl', id, url]);
  else await run(ADB, ['-s', id, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url, APP_ID]);
  const linked = await readSnapshot(target);
  await confirmAppLink(target, linked.data?.snapshot ?? linked.data);
  if (noConfirm) { console.log(`Consent is waiting on ${target.name}; pairing has not completed.`); return; }
  await agent(target, ['wait', 'text', 'Fingerprint', '30000']);
  await agent(target, ['scroll', 'down', '--until', 'label="Name"', '--settle']);
  const fields = await readSnapshot(target);
  const name = (fields.data?.snapshot?.nodes ?? fields.data?.nodes ?? []).find(node =>
    (node.editable || /TextField|EditText/.test(node.type ?? ''))
    && [node.label, node.contentDescription, node.identifier].includes('Name'));
  if (!name?.ref) throw new Error('The pairing Name input is not accessible in the current snapshot');
  await agent(target, ['fill', `@${name.ref}`, target.name, '--settle']);
  // The single-line Name field has no submit action; Return ends editing.
  // A software keyboard can otherwise cover the consent button on iOS.
  if (target.platform === 'ios') await agent(target, ['keyboard', 'enter']);
  else await agent(target, ['keyboard', 'dismiss']);
  await agent(target, ['scroll', 'down', '--until', 'label="Pair this device"', '--settle']);
  const consent = await readSnapshot(target);
  const confirm = (consent.data?.snapshot?.nodes ?? consent.data?.nodes ?? []).find(node =>
    node.identifier === 'pairing-confirm' || (node.type === 'Button' && node.label === 'Pair this device'));
  if (!confirm?.ref) throw new Error('The pairing confirmation button is not accessible');
  await agent(target, ['press', `@${confirm.ref}`, '--settle']);
  await agent(target, ['wait', 'id="menu-button"', '30000']);
  await recordPairing(session, target, before, started);
}

/** Verify consent created a fresh device, including after a Maestro pairing flow. */
export async function recordPairing(session, target, before, started) {
  const id = targetId(target);
  let device;
  for (let attempt = 0; attempt < 10; attempt++) {
    const current = await session.api('/auth/devices');
    device = current.devices.find(item => !before.has(item.deviceId) && item.name === target.name && !item.revokedAt
      && new Date(item.createdAt).getTime() >= started - 60000);
    if (device) break;
    await delay(500);
  }
  if (!device) throw new Error(`Could not verify the new pairing for ${target.name}`);
  session.state.paired = [...(session.state.paired ?? []).filter(item => targetId(item) !== id),
    { ...target, deviceId: device.deviceId, host: targetHost(target) }];
  await session.save();
  console.log(`pair: ${target.name} verified on the sandbox`);
}
