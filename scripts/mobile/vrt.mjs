#!/usr/bin/env node
// Mobile visual regression (08 §4.6, M4-10 → M10-03). Captures every kit / block story through the dev Storybook route
// (`generatorai:///storybook?story=<id>&theme=&mode=&accent=`, `.rnstorybook/Screen.tsx`) on the booted pinned
// simulator / emulator, and compares with the committed per-device baselines in apps/mobile/vrt/baselines/ (odiff).
//
//   node scripts/mobile/vrt.mjs --list [--grep=<regex>]
//   node scripts/mobile/vrt.mjs --platform=ios|android|both [--device=phone|tablet] [--grep=<regex>]
//                               [--variants=<a,b>] [--update]
//
// Needs: the device booted and sandbox-paired (the dev routes sit behind the auth gate), Metro started with
// `EXPO_PUBLIC_STORYBOOK=1 EXPO_PUBLIC_VRT=1` (frozen clock, seeded random, reduced motion: `.rnstorybook/vrtMode.ts`).
// Exit 1 on an unexpected diff, a missing baseline or a capture failure; `--update` records the current captures as
// the baselines (and META.json) and prints what changed.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { ROOT } from './lib/sandbox-session.mjs';
import { ADB, agent, findTargets, run, targetId } from './lib/sandbox-devices.mjs';
import { DIFF_OPTIONS, TEXT_SIZES, baselineFile, capturePlan, captureUrl, deviceMismatch, indexStories, summarize, variantsFor } from './lib/vrt-plan.mjs';

const mobile = path.join(ROOT, 'apps/mobile');
const requireMobile = createRequire(path.join(mobile, 'package.json'));
/** Android screenshots arrive at device density; 0.4 ≈ one pixel per dp, like the iOS simulator's 1x default. */
const ANDROID_SCALE = '0.4';
const DEVICE_NAMES = { ios: { phone: 'gai-iphone', tablet: 'gai-ipad' }, android: { phone: 'gai-phone', tablet: 'gai-tablet' } };

async function storySources() {
  const files = [];
  for (const dir of ['src/ui', 'src/blocks']) {
    for await (const entry of fs.glob('**/*.stories.tsx', { cwd: path.join(mobile, dir) })) files.push(path.join(mobile, dir, entry));
  }
  return Promise.all(files.sort().map(async (file) => ({ file: path.relative(ROOT, file), code: await fs.readFile(file, 'utf8') })));
}

async function currentDevice(target) {
  if (target.platform === 'ios') {
    const { devices } = JSON.parse(await run('xcrun', ['simctl', 'list', 'devices', '--json']));
    const types = JSON.parse(await run('xcrun', ['simctl', 'list', 'devicetypes', '--json'])).devicetypes;
    const runtimes = JSON.parse(await run('xcrun', ['simctl', 'list', 'runtimes', '--json'])).runtimes;
    for (const [runtime, list] of Object.entries(devices)) {
      const device = list.find((item) => item.udid === target.udid);
      if (device) {
        return {
          deviceType: types.find((type) => type.identifier === device.deviceTypeIdentifier)?.name ?? device.deviceTypeIdentifier,
          runtime: runtimes.find((item) => item.identifier === runtime)?.name ?? runtime,
        };
      }
    }
    throw new Error(`Simulator ${target.udid} not found`);
  }
  const prop = async (name) => (await run(ADB, ['-s', target.serial, 'shell', 'getprop', name])).trim();
  return { deviceType: await prop('ro.product.model'), image: `android-${await prop('ro.build.version.sdk')};${await prop('ro.product.cpu.abi')}` };
}

/** Deterministic chrome and no animation (08 §4.6 step 2). */
async function prepare(target) {
  if (target.platform === 'ios') {
    await run('xcrun', ['simctl', 'status_bar', target.udid, 'override', '--time', '9:41', '--batteryState', 'charged',
      '--batteryLevel', '100', '--cellularBars', '4', '--wifiBars', '3']);
  } else {
    const shell = (...args) => run(ADB, ['-s', target.serial, 'shell', ...args]);
    for (const key of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) await shell('settings', 'put', 'global', key, '0');
    await shell('settings', 'put', 'global', 'sysui_demo_allowed', '1');
    const demo = (...extra) => shell('am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', ...extra);
    await demo('enter');
    await demo('clock', '-e', 'hhmm', '0941');
    await demo('battery', '-e', 'level', '100', '-e', 'plugged', 'false');
    await demo('network', '-e', 'wifi', 'show', '-e', 'level', '4');
    await demo('notifications', '-e', 'visible', 'false');
    await agent(target, ['settings', 'animations', 'off']);
  }
  // iOS: agent-device has no animation setting for the simulator; VRT mode forces Reduce Motion in the app.
}

async function restore(target) {
  if (target.platform === 'ios') await run('xcrun', ['simctl', 'status_bar', target.udid, 'clear']).catch(() => undefined);
  else await run(ADB, ['-s', target.serial, 'shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'exit']).catch(() => undefined);
  await agent(target, ['settings', 'text-size', TEXT_SIZES.default]).catch(() => undefined);
}

async function capture(target, plan, outDir) {
  const shots = [];
  let textSize = null;
  for (const item of plan) {
    if (item.textSize !== textSize) {
      textSize = item.textSize;
      await agent(target, ['settings', 'text-size', TEXT_SIZES[textSize]]);
      // Android adopts a new font scale on the next configuration change: relaunch the app.
      if (target.platform === 'android') await agent(target, ['open', 'dev.generatorai.app', '--relaunch']);
    }
    const file = path.join(outDir, `${item.storyId}--${item.variant}.png`);
    try {
      await agent(target, ['open', captureUrl(item.storyId, item.variant)]);
      await agent(target, ['wait', 'id="vrt-ready"', '10000']);
      await agent(target, ['screenshot', '--out', file, '--crop-on', 'id="vrt-root"', ...(target.platform === 'ios' ? ['--normalize-status-bar'] : ['--scale', ANDROID_SCALE])]);
      shots.push({ ...item, file });
    } catch (error) {
      shots.push({ ...item, error: error.message });
    }
  }
  return shots;
}

async function compareShots(target, device, shots, reportDir, update) {
  const { compare } = requireMobile('odiff-bin');
  const results = [];
  for (const shot of shots) {
    const baseline = baselineFile(ROOT, target.platform, device, shot.storyId, shot.variant);
    if (shot.error) { results.push({ ...shot, status: 'failed', detail: shot.error }); continue; }
    if (update) {
      const changed = !existsSync(baseline) || !(await compare(baseline, shot.file, path.join(reportDir, 'tmp-diff.png'), DIFF_OPTIONS)).match;
      if (changed) {
        await fs.mkdir(path.dirname(baseline), { recursive: true });
        await fs.copyFile(shot.file, baseline);
      }
      results.push({ ...shot, status: changed ? 'updated' : 'match', baseline });
      continue;
    }
    if (!existsSync(baseline)) { results.push({ ...shot, status: 'missing', baseline }); continue; }
    const diff = path.join(reportDir, `${shot.storyId}--${shot.variant}.diff.png`);
    const result = await compare(baseline, shot.file, diff, DIFF_OPTIONS);
    results.push({ ...shot, baseline, diff: result.match ? undefined : diff,
      status: result.match ? 'match' : result.reason === 'layout-diff' ? 'layout' : 'diff',
      detail: result.reason === 'pixel-diff' ? `${result.diffPercentage.toFixed(2)} % pixels` : result.reason });
  }
  return results;
}

function reportHtml(results) {
  const rows = results.filter((r) => r.status !== 'match').map((r) => {
    const img = (file) => (file && existsSync(file) ? `<img src="file://${file}" loading="lazy">` : '—');
    return `<tr><td>${r.storyId}<br>${r.variant}<br><b>${r.status}</b> ${r.detail ?? ''}</td><td>${img(r.baseline)}</td><td>${img(r.file)}</td><td>${img(r.diff)}</td></tr>`;
  });
  return `<!doctype html><meta charset="utf-8"><title>Mobile VRT</title><style>body{font:14px system-ui}img{max-width:280px}td{vertical-align:top;padding:4px}</style>
<table><tr><th>story</th><th>baseline</th><th>current</th><th>diff</th></tr>${rows.join('\n') || '<tr><td>All captures match.</td></tr>'}</table>`;
}

async function main() {
  const { values } = parseArgs({ options: {
    platform: { type: 'string', default: 'both' }, device: { type: 'string', default: 'phone' }, grep: { type: 'string' },
    variants: { type: 'string' }, update: { type: 'boolean' }, list: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) { console.log('Usage: node scripts/mobile/vrt.mjs [--list] [--platform=ios|android|both] [--device=phone|tablet] [--grep=<regex>] [--variants=<a,b>] [--update]'); return; }
  const { loadCsf } = await import(requireMobile.resolve('storybook/internal/csf-tools'));
  const stories = indexStories(await storySources(), loadCsf);
  const plan = capturePlan(stories, { grep: values.grep, variants: values.variants?.split(',').filter(Boolean) });
  if (values.list) {
    for (const story of stories) if (!values.grep || new RegExp(values.grep).test(story.id)) console.log(`${story.id}  ${variantsFor(story.vrt).join(' ') || `(skipped: ${story.vrt.skip})`}`);
    console.log(`${stories.length} stories, ${plan.length} captures per device`);
    return;
  }
  if (!['phone', 'tablet'].includes(values.device)) throw new Error('--device must be phone or tablet');
  const platforms = values.platform === 'both' ? ['ios', 'android'] : [values.platform];
  let exitCode = 0;
  for (const platform of platforms) {
    const name = DEVICE_NAMES[platform]?.[values.device];
    if (!name) throw new Error('--platform must be ios, android or both');
    const target = (await findTargets({ platform })).find((item) => item.name === name);
    if (!target) throw new Error(`Boot ${name} first (node scripts/mobile/doctor.mjs lists the pinned devices)`);
    const current = await currentDevice(target);
    const metaFile = path.join(mobile, 'vrt/baselines', platform, values.device, 'META.json');
    const meta = existsSync(metaFile) ? JSON.parse(await fs.readFile(metaFile, 'utf8')) : null;
    const mismatch = deviceMismatch(meta, current);
    if (mismatch && !values.update) {
      throw new Error(`Baselines for ${platform}/${values.device} were recorded on another device (${mismatch}). Re-baseline on purpose: node scripts/mobile/vrt.mjs --platform=${platform} --device=${values.device} --update`);
    }
    const reportDir = path.join(mobile, 'vrt/report', `${platform}-${values.device}`);
    await fs.rm(reportDir, { recursive: true, force: true });
    await fs.mkdir(reportDir, { recursive: true });
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), `generatorai-vrt-${platform}-`));
    console.log(`vrt: ${targetId(target)} (${name}) — ${plan.length} captures`);
    try {
      await prepare(target);
      const shots = await capture(target, plan, outDir);
      const results = await compareShots(target, values.device, shots, reportDir, values.update);
      if (values.update) {
        const recordedAt = new Date().toISOString();
        const commit = (await run('git', ['rev-parse', '--short', 'HEAD'])).trim();
        await fs.mkdir(path.dirname(metaFile), { recursive: true });
        await fs.writeFile(metaFile, `${JSON.stringify({ ...current, fontScaleMap: TEXT_SIZES, recordedAt, commit }, null, 2)}\n`);
      }
      // Keep the current captures that matter next to the report (temp dir is removed below).
      for (const result of results.filter((r) => r.status !== 'match' && r.file)) {
        const kept = path.join(reportDir, path.basename(result.file));
        await fs.copyFile(result.file, kept);
        result.file = kept;
      }
      await fs.writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify({ platform, device: values.device, current, results }, null, 2)}\n`);
      await fs.writeFile(path.join(reportDir, 'index.html'), reportHtml(results));
      const { counts, exitCode: code } = summarize(results, { update: values.update });
      for (const result of results.filter((r) => r.status !== 'match')) console.log(`  ${result.status.padEnd(7)} ${result.storyId} ${result.variant} ${result.detail ?? ''}`);
      console.log(`vrt: ${platform}/${values.device} ${JSON.stringify(counts)} → ${path.relative(ROOT, reportDir)}/index.html`);
      exitCode ||= code;
    } finally {
      await restore(target);
      await fs.rm(outDir, { recursive: true, force: true });
    }
  }
  process.exitCode = exitCode;
}

main().catch((error) => { console.error(`vrt: ${error.message}`); process.exitCode = 1; });
