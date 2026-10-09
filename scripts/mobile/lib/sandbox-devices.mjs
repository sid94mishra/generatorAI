import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { agentCommand } from './agent-command.mjs';
import { ROOT } from './sandbox-session.mjs';
import { findNewPairing, rewritePairUrl } from './sandbox-data.mjs';

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
  return rewritePairUrl(offer.pairingUrl, target.platform);
}
// The pinned driver's iOS presentation heuristic treats an empty fullscreen
// toolbar as an overlay. Raw XCTest preserves the native hittability/refs;
// fill/press still enforce keyboard and target checks. No coordinate fallback.
async function readSnapshot(target, interactive = true) {
  // A raw iOS tree of Home takes 5-10 s while the runner is busy; a 5 s cap cancelled every read.
  const deadline = Date.now() + 45000;
  let lastError;
  do {
    try { return JSON.parse(await agent(target, ['snapshot', ...(target.platform === 'ios' ? ['--raw'] : interactive ? ['-i'] : []), '--timeout', '20000'])); }
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
// A fresh install's first Metro bundle plus a cold XCTest runner can take a few minutes on a loaded machine.
const APP_READY_MS = 300000;
// One iOS snapshot can take 5–17 s while the XCTest runner is busy; a 30 s step wait then sees only one or two.
const STEP_WAIT_MS = 90000;
async function waitForApp(target) {
  const deadline = Date.now() + APP_READY_MS;
  while (Date.now() < deadline) {
    let snapshot;
    try {
      const result = JSON.parse(await agent(target, ['snapshot', ...(target.platform === 'ios' ? ['--raw'] : []), '--json', '--timeout', '15000']));
      snapshot = result.data?.snapshot ?? result.data;
    } catch { /* The first Metro bundle can temporarily leave no readable native tree. */ }
    const nodes = snapshot?.nodes ?? [];
    const labels = nodes.map(node => node.label ?? node.value ?? '');
    // Restarting the isolated sandbox rotates its identity. A previously paired
    // app then shows ConnectionError, not the unpaired screen. Follow its visible
    // recovery action; the fresh grant still requires normal consent below.
    const pairAgain = nodes.find(node => node.label === 'Pair with a different host' && (/Button$/.test(node.type ?? '') || node.clickable));
    if (pairAgain?.ref && labels.some(label => label === 'Can’t reach your server' || label === 'Sign-in needs refreshing')) {
      await agent(target, ['press', `@${pairAgain.ref}`, '--settle']);
      continue;
    }
    // A pairing the trust layer refuses (MV-44: a new sandbox CA, or a plain-HTTP pairing) names it and offers "Pair again".
    const repair = nodes.find(node => node.identifier === 'connection-pair-again');
    if (repair?.ref) {
      await agent(target, ['press', `@${repair.ref}`, '--settle']);
      continue;
    }
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
    if (nodes.some(node => ['menu-button', 'home-new-chat', 'pairing-connect', 'pairing-confirm', 'paired-continue'].includes(node.identifier) || node.label === 'Connect to a GeneratorAI server')) return;
    if (nodes.some(node => node.label === 'Unlock to continue')) throw new Error('The installed app is locked; unlock it before native verification');
    await confirmAppLink(target, snapshot);
    await delay(500);
  }
  throw new Error(`The app did not reach its pairing screen or shell within ${APP_READY_MS / 1000} seconds; check Metro and native logs`);
}
async function snapshotIdentifiers(target) {
  // The full tree (not -i on Android): callouts such as `pairing-error` are not interactive.
  const snapshot = await readSnapshot(target, false);
  return new Set((snapshot.data?.snapshot?.nodes ?? snapshot.data?.nodes ?? []).map(node => node.identifier).filter(Boolean));
}
async function hasIdentifier(target, id) { return (await snapshotIdentifiers(target)).has(id); }
/** Wait until any of the testIDs is in the native tree (raw on iOS, like waitForApp). */
async function waitForIdentifier(target, ids, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const found = await snapshotIdentifiers(target);
      if (ids.some(id => found.has(id))) return;
    } catch { /* A transition can briefly leave no readable tree. */ }
    await delay(500);
  }
  throw new Error(`None of ${ids.join(', ')} appeared on ${target.name} within ${timeout / 1000} s`);
}
/**
 * Scroll a control into view and press it. A press that lands while a screen is still animating in (the
 * consent → /paired transition) fails with COMMAND_FAILED, so it retries after the transition settles.
 */
/** Screen-point centre of the element with this testID, from the native tree. */
async function centreOf(target, id) {
  const snapshot = await readSnapshot(target, false);
  const node = (snapshot.data?.snapshot?.nodes ?? snapshot.data?.nodes ?? []).find(item => item.identifier === id);
  const rect = node?.rect ?? node?.frame ?? node?.bounds;
  if (!rect) throw new Error(`${id} is not in the native tree on ${target.name}`);
  return [String(Math.round(rect.x + rect.width / 2)), String(Math.round(rect.y + rect.height / 2))];
}
async function scrollAndPress(target, id, next = []) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // A press reported as failed may still have landed: stop once the next screen is showing.
      if (attempt > 0 && next.length && [...(await snapshotIdentifiers(target))].some(found => next.includes(found))) return;
      await agent(target, ['scroll', 'down', '--until', `id="${id}"`, '--settle']);
      try {
        await agent(target, ['press', `id="${id}"`, '--settle']);
      } catch {
        // agent-device refuses a selector press when a full-screen pass-through container (the native toolbar
        // host, the overlay window) overlaps the control, although a real tap reaches it. Tap its centre as a user would.
        await agent(target, ['press', ...(await centreOf(target, id)), '--settle']);
      }
      return;
    } catch (error) { lastError = error; await delay(1500); }
  }
  throw lastError;
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
  // M7-08 (MD-34): the link only pre-fills the 12-character code and the server address ("Server found" callout);
  // Connect opens the consent step. Every control is reached by its testID — no snapshot refs, no typing.
  await agent(target, ['wait', 'id="pairing-scanned"', String(STEP_WAIT_MS)]);
  await scrollAndPress(target, 'pairing-connect', ['pairing-fingerprint']);
  if (noConfirm) { console.log(`Consent is waiting on ${target.name}; pairing has not completed.`); return; }
  await agent(target, ['wait', 'id="pairing-fingerprint"', String(STEP_WAIT_MS)]);
  // The device name keeps its default ("My iPhone", "My phone", …): the Name field auto-capitalises and
  // auto-corrects, so typed text never verifies on iOS (agent-device fill → COMMAND_FAILED), and the new device is
  // identified by its id instead (findNewPairing). No keyboard opens, so nothing covers "Pair".
  await scrollAndPress(target, 'pairing-confirm', ['paired', 'paired-continue', 'pairing-error']);
  // The success step (`/paired`): Continue skips the optional approval-key setup (Settings › Security later).
  // Its screen id, not Continue: on a phone Continue sits below the scope list, and Android's tree has only what is on screen.
  await waitForIdentifier(target, ['paired', 'paired-continue', 'pairing-error'], STEP_WAIT_MS);
  if (await hasIdentifier(target, 'pairing-error')) throw new Error(`Pairing ${target.name} failed on the consent step; see the app's error callout`);
  await scrollAndPress(target, 'paired-continue', ['home-new-chat', 'menu-button']);
  // Home on a phone (sidebar toggle `menu-button`) or a tablet (persistent sidebar; `home-new-chat` either way).
  await waitForIdentifier(target, ['home-new-chat', 'menu-button'], STEP_WAIT_MS);
  await recordPairing(session, target, before, started);
}

/** Verify consent created a fresh device, including after a Maestro pairing flow. */
export async function recordPairing(session, target, before, started) {
  const id = targetId(target);
  let device;
  for (let attempt = 0; attempt < 10; attempt++) {
    const current = await session.api('/auth/devices');
    device = findNewPairing(current.devices, { before, started, name: target.name });
    if (device) break;
    await delay(500);
  }
  if (!device) throw new Error(`Could not verify the new pairing for ${target.name}`);
  session.state.paired = [...(session.state.paired ?? []).filter(item => targetId(item) !== id),
    { ...target, deviceId: device.deviceId, host: targetHost(target) }];
  await session.save();
  console.log(`pair: ${target.name} verified on the sandbox`);
}
